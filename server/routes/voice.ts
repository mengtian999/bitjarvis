/**
 * Realtime voice WebSocket — 全双工语音通道（Phase 2/4a/4b/5）。
 *
 * Renderer 采集麦克风 → Int16 PCM 分帧上行 → 服务端能量 VAD 端点检测
 * → 成段后转写 → 按模式处理:
 *   - dictation(听写,默认): 仅返回识别文本,不触发 TTS。
 *   - conversation(语音对话): 文本提交给当前会话的 Agent(submitDesktopSessionMessage),
 *     回复经现有 hub 流式事件进入聊天窗口,同时按句切分流式 TTS 播报。
 * 支持 barge-in:TTS 播报/思考期间检测到用户持续开口即停(能量门槛,见 P1)。
 *
 * Client -> Server:
 *   { type:"start", sampleRate?:number, mode?:"dictation"|"conversation", sessionPath?:string, channelName?:string }
 *   { type:"audio", data:"<base64 Int16 PCM 小端>" }
 *   { type:"stop" }
 *   { type:"interrupt" }
 *
 * conversation 目标二选一:sessionPath(1:1 会话,流式回复按句播报)或
 * channelName(频道群聊:说话即发频道消息,成员 Agent 回复到达即播报)。
 * Server -> Client:
 *   { type:"ready", sampleRate, principal?, mode }
 *   { type:"vad", state:"speech"|"silence" }
 *   { type:"interim", id, text, durationMs }
 *   { type:"final", id, text, durationMs, truncated }
 *   { type:"thinking" }
 *   { type:"agent_delta", delta }                (conversation: 回复增量,UI 可选消费)
 *   { type:"channel_message_sent", channel, sender, timestamp, body }
 *                                                (channel conversation: 用户语音消息已入频道的回显)
 *   { type:"tts_start", id, text }
 *   { type:"tts_audio", data:"<base64 MP3/WAV chunk>" }
 *   { type:"tts_end", id }
 *   { type:"agent_turn_end" }                    (conversation: 回合结束,可切回聆听)
 *   { type:"interrupt" }
 *   { type:"error", message? }
 *   { type:"ended" }
 */
import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RealtimeVoiceSession, computeRms } from "../../core/realtime-voice/session.ts";
import { submitDesktopSessionMessage } from "../../core/desktop-session-submit.ts";
import { submitUserChannelMessage } from "../../core/channel-manager.ts";
import { createRequestContext } from "../http/boundary.ts";
import { wsSend } from "../ws-protocol.ts";

// barge-in 门槛:能量需持续超过该值一段时间才打断播报。
// 高于 VAD speechThreshold(1400)并要求持续时长,避免回声/短促噪声误打断。
const BARGE_IN_RMS = 2600;
const BARGE_IN_MIN_MS = 220;
// conversation 模式按句切分:句末标点触发一段 TTS;超过该长度强制切段
const SPEAK_SEGMENT_MAX = 120;
const SENTENCE_END_RE = /[。！？!?;;\n\r]/;
// 频道模式:提交后等待首条回复的超时;回复间歇判定回合结束的静默时长
const CHANNEL_FIRST_REPLY_MS = 10_000;
const CHANNEL_IDLE_MS = 8_000;

// 兼容旧签名 createVoiceRoute(engine, { upgradeWebSocket })与新签名 (engine, hub, {...})
export function createVoiceRoute(engine: any, hubOrOpts: any, maybeOpts?: any) {
  const hub = maybeOpts ? hubOrOpts : null;
  const { upgradeWebSocket } = maybeOpts || hubOrOpts || {};
  const route = new Hono();

  route.get(
    "/voice",
    upgradeWebSocket((c) => {
      let closed = false;
      let session: RealtimeVoiceSession | null = null;
      let currentWs: any = null;
      let sampleRate = 16000;
      let atMs = 0;
      let ttsAbortController: AbortController | null = null;
      let bargeInMs = 0;
      let voiceState: 'idle' | 'listening' | 'thinking' | 'speaking' = 'idle';
      // conversation 模式状态
      let mode: 'dictation' | 'conversation' = 'dictation';
      let sessionPath = '';
      // 频道目标(conversation 且 channelName 时为频道群聊模式)
      let channelName = '';
      let channelUnsub: (() => void) | null = null;
      let channelFirstReplyTimer: ReturnType<typeof setTimeout> | null = null;
      let channelIdleTimer: ReturnType<typeof setTimeout> | null = null;
      let channelSpeakPending = 0;
      let agentTurnActive = false;
      let turnEpoch = 0;
      // 按句切分的 TTS 队列
      let speakBuffer = '';
      let spokenUpTo = 0;
      let speakChain: Promise<void> = Promise.resolve();

      const requestContext = createRequestContext(c, engine);

      const send = (msg: Record<string, unknown>) => {
        if (!closed && currentWs) wsSend(currentWs, msg);
      };

      async function handleUtterance(payload: { id: string; wavBase64: string; durationMs: number; sampleRate: number }, truncated: boolean) {
        const transcribe = engine?.speechRecognition?.transcribePcmFile;
        if (typeof transcribe !== "function") {
          send({ type: "error", message: "speech recognition unavailable" });
          return;
        }
        const tmp = path.join(os.tmpdir(), `jarvis-voice-${payload.id}.wav`);
        try {
          fs.writeFileSync(tmp, Buffer.from(payload.wavBase64, "base64"));
          let text = "";
          try {
            const res = await transcribe.call(engine.speechRecognition, { filePath: tmp });
            text = res?.text || "";
          } catch (err) {
            send({ type: "error", message: String(err?.message || err) });
            return;
          }
          send({ type: "final", id: payload.id, text, durationMs: payload.durationMs, truncated });
          if (!text || closed) return;
          if (mode === 'conversation') {
            if (channelName) {
              await channelSubmit(text);
            } else {
              await agentTurn(text);
            }
          }
          // dictation 模式:仅返回文本,不触发 TTS(修复“听写把自己的话读出来”)
        } finally {
          try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        }
      }

      async function handleInterim(payload: { id: string; wavBase64: string; durationMs: number; sampleRate: number }) {
        const transcribe = engine?.speechRecognition?.transcribePcmFile;
        if (typeof transcribe !== "function") return;
        const tmp = path.join(os.tmpdir(), `jarvis-voice-interim-${payload.id}.wav`);
        try {
          fs.writeFileSync(tmp, Buffer.from(payload.wavBase64, "base64"));
          const res = await transcribe.call(engine.speechRecognition, { filePath: tmp });
          const text = res?.text || "";
          if (text) send({ type: "interim", id: payload.id, text, durationMs: payload.durationMs });
        } catch { /* interim 失败不报错，静默忽略 */ }
        finally {
          try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        }
      }

      // ── conversation:回复按句切分流式 TTS ──

      /** 把回复累积文本中「可播报的部分」切段入队;句末标点或超长触发。 */
      function enqueueSpeak(accumulated: string, voice: string | null = null) {
        speakBuffer = accumulated.slice(spokenUpTo);
        let cut = -1;
        const m = SENTENCE_END_RE.exec(speakBuffer);
        if (m && m.index !== undefined) cut = m.index + 1;
        if (cut < 0 && speakBuffer.length >= SPEAK_SEGMENT_MAX) {
          // 无标点但过长:在最近的空格/逗号处切
          const soft = Math.max(speakBuffer.lastIndexOf('，'), speakBuffer.lastIndexOf(','), speakBuffer.lastIndexOf(' '));
          cut = soft > SPEAK_SEGMENT_MAX / 2 ? soft + 1 : speakBuffer.length;
        }
        if (cut > 0) {
          const segment = speakBuffer.slice(0, cut).trim();
          spokenUpTo += cut;
          speakBuffer = '';
          if (segment) queueSpeak(segment, voice);
        }
      }

      function flushSpeak(voice: string | null = null) {
        const segment = speakBuffer.trim();
        speakBuffer = '';
        if (segment) queueSpeak(segment, voice);
      }

      function queueSpeak(text: string, voice: string | null = null) {
        speakChain = speakChain.then(() => speakSegment(text, voice)).catch(() => { /* 单段失败不阻断后续段 */ });
      }

      async function speakSegment(text: string, voice: string | null = null) {
        if (closed || !engine?.tts) return;
        const ttsId = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ac = new AbortController();
        ttsAbortController = ac;
        voiceState = 'speaking';
        send({ type: "tts_start", id: ttsId, text: text.substring(0, 100) });
        try {
          await engine.tts.synthesizeStream(
            { text, ...(voice ? { voice } : {}) },
            (chunk: Buffer) => {
              if (ac.signal.aborted || closed) throw new Error("aborted");
              send({ type: "tts_audio", data: Buffer.from(chunk).toString("base64") });
            },
            () => {
              if (!ac.signal.aborted && !closed) {
                send({ type: "tts_end", id: ttsId });
                voiceState = 'thinking';
              }
            },
          );
        } catch (err) {
          if ((err as Error)?.message !== "aborted" && !closed) {
            send({ type: "error", message: String((err as Error)?.message || "tts failed") });
          }
        } finally {
          if (ttsAbortController === ac) ttsAbortController = null;
        }
      }

      /** conversation:识别文本 → Agent 回复(进入当前会话)→ 按句 TTS 播报。 */
      async function agentTurn(text: string) {
        if (!engine?.tts) { send({ type: "error", message: "tts unavailable" }); return; }
        if (!sessionPath) { send({ type: "error", message: "conversation mode requires sessionPath" }); return; }
        const epoch = ++turnEpoch;
        // 解析本会话所属 agent 的音色：未配置时回落全局 tts.voice（不传 voice 即回落）。
        const ownerAgentId = typeof engine?.agentIdFromSessionPath === "function"
          ? engine.agentIdFromSessionPath(sessionPath)
          : null;
        const voice = ownerAgentId ? resolveAgentVoice(ownerAgentId) : null;
        voiceState = 'thinking';
        bargeInMs = 0;
        // 丢弃 TTS 开始前的半截语音段,避免助手音频混入待转写的用户语句
        session?.reset();
        speakBuffer = '';
        spokenUpTo = 0;
        speakChain = Promise.resolve();
        send({ type: "thinking" });
        agentTurnActive = true;
        try {
          const result = await submitDesktopSessionMessage(engine, {
            sessionPath,
            text,
            onDelta: (delta: string, accumulated: string) => {
              if (epoch !== turnEpoch) return;
              send({ type: "agent_delta", delta });
              enqueueSpeak(accumulated, voice);
            },
          });
          if (epoch !== turnEpoch) return; // 已被打断
          flushSpeak(voice);
          await speakChain;
          // 无流式 delta(如仅工具卡产出)时用最终文本兜底播报
          if (result?.text && spokenUpTo === 0 && !closed) {
            await speakSegment(result.text, voice);
          }
          if (epoch === turnEpoch && !closed) {
            voiceState = 'listening';
            // 回合结束信号:渲染端据此切回聆听态(此前每个分段结束就切,段间状态闪烁)
            send({ type: "agent_turn_end" });
          }
        } catch (err) {
          const message = String((err as Error)?.message || err);
          if (!closed && epoch === turnEpoch) {
            if (message === "session_busy") {
              send({ type: "error", message: "session is busy (typing message in progress)" });
            } else {
              send({ type: "error", message });
            }
            voiceState = 'listening';
          }
        } finally {
          if (epoch === turnEpoch) agentTurnActive = false;
        }
      }

      // ── conversation(频道):连续群聊模式 ──
      // 说话 = 向频道提交用户消息(触发既有投递编排);成员 Agent 的回复经
      // channel_new_message 事件到达即播报(带发言人前缀)。无单一回合,
      // 以"回复间歇 + 播报队列排空"判定一轮结束。

      function resolveAgentDisplayName(agentId: string): string {
        try {
          const hit = (engine.listAgents?.() || []).find((a: any) => a?.id === agentId);
          return hit?.displayName || hit?.name || agentId;
        } catch { return agentId; }
      }

      function resolveAgentVoice(agentId: string): string | null {
        try {
          const hit = (engine.listAgents?.() || []).find((a: any) => a?.id === agentId);
          return typeof hit?.voice === "string" && hit.voice.trim() ? hit.voice.trim() : null;
        } catch { return null; }
      }

      function channelRoundFinish() {
        if (closed || mode !== 'conversation' || !channelName) return;
        channelFirstReplyTimer = null;
        channelIdleTimer = null;
        if (voiceState !== 'listening') {
          voiceState = 'listening';
          send({ type: "agent_turn_end" });
        }
      }

      function armChannelFirstReplyTimer() {
        if (channelFirstReplyTimer) clearTimeout(channelFirstReplyTimer);
        channelFirstReplyTimer = setTimeout(() => {
          channelFirstReplyTimer = null;
          if (channelSpeakPending === 0 && !ttsAbortController) channelRoundFinish();
          else armChannelIdleTimer();
        }, CHANNEL_FIRST_REPLY_MS);
      }

      function armChannelIdleTimer() {
        if (channelIdleTimer) clearTimeout(channelIdleTimer);
        channelIdleTimer = setTimeout(() => {
          channelIdleTimer = null;
          if (channelSpeakPending === 0 && !ttsAbortController) channelRoundFinish();
          else armChannelIdleTimer();
        }, CHANNEL_IDLE_MS);
      }

      function queueChannelSpeak(text: string, voice: string | null = null) {
        channelSpeakPending++;
        armChannelIdleTimer();
        speakChain = speakChain
          .then(() => speakSegment(text, voice))
          .catch(() => { /* 单段失败不阻断后续段 */ })
          .finally(() => {
            channelSpeakPending--;
            if (channelSpeakPending === 0) armChannelIdleTimer();
          });
      }

      /** 订阅频道回复事件;仅播报本频道、非用户发送的消息。 */
      function subscribeChannelReplies() {
        if (channelUnsub || typeof hub?.subscribe !== "function") return;
        const userName = engine?.userName || "user";
        channelUnsub = hub.subscribe((event: any) => {
          if (!event || event.type !== "channel_new_message") return;
          if (event.channelName !== channelName) return;
          const sender = event.sender || event.message?.sender;
          if (!sender || sender === userName) return;
          const body = event.message?.body;
          if (!body || closed) return;
          if (channelFirstReplyTimer) { clearTimeout(channelFirstReplyTimer); channelFirstReplyTimer = null; }
          const senderVoice = resolveAgentVoice(String(sender));
          queueChannelSpeak(`${resolveAgentDisplayName(String(sender))}：${String(body)}`, senderVoice);
        });
      }

      function teardownChannel(submitStop: boolean) {
        if (channelFirstReplyTimer) { clearTimeout(channelFirstReplyTimer); channelFirstReplyTimer = null; }
        if (channelIdleTimer) { clearTimeout(channelIdleTimer); channelIdleTimer = null; }
        channelSpeakPending = 0;
        try { channelUnsub?.(); } catch { /* ignore */ }
        channelUnsub = null;
        if (submitStop && channelName && typeof hub?.abortAgentPhoneSessions === "function") {
          try {
            hub.abortAgentPhoneSessions("voice-stopped", {
              conversationId: channelName,
              conversationType: "channel",
            });
          } catch { /* ignore */ }
        }
      }

      async function channelSubmit(text: string) {
        if (!engine?.tts) { send({ type: "error", message: "tts unavailable" }); return; }
        if (!channelName) { send({ type: "error", message: "conversation mode requires channelName" }); return; }
        voiceState = 'thinking';
        bargeInMs = 0;
        session?.reset();
        speakBuffer = '';
        spokenUpTo = 0;
        speakChain = Promise.resolve();
        send({ type: "thinking" });
        subscribeChannelReplies();
        armChannelFirstReplyTimer();
        try {
          const result = await submitUserChannelMessage(engine, hub, { name: channelName, body: text });
          if (!closed) {
            // 回显给发送端 UI:REST 打字路径是本地乐观追加,语音路径由服务端确认后
            // 通过该消息让渲染端把这条用户消息写进频道消息列表
            send({
              type: "channel_message_sent",
              channel: channelName,
              sender: result.senderName,
              timestamp: result.timestamp,
              body: text,
            });
          }
        } catch (err) {
          if (!closed) {
            send({ type: "error", message: String((err as Error)?.message || err) });
            if (voiceState === 'thinking') {
              voiceState = 'listening';
              send({ type: "agent_turn_end" });
            }
          }
          if (channelFirstReplyTimer) { clearTimeout(channelFirstReplyTimer); channelFirstReplyTimer = null; }
        }
      }

      function doInterrupt() {
        if (voiceState === 'speaking' || voiceState === 'thinking') {
          turnEpoch++; // 作废进行中的 agentTurn 后续处理
          if (ttsAbortController) {
            try { ttsAbortController.abort(); } catch { /* ignore */ }
          }
          ttsAbortController = null;
          if (mode === 'conversation' && channelName) {
            // 频道:中止播报队列与各成员 Agent 的生成
            channelSpeakPending = 0;
            if (channelFirstReplyTimer) { clearTimeout(channelFirstReplyTimer); channelFirstReplyTimer = null; }
            if (channelIdleTimer) { clearTimeout(channelIdleTimer); channelIdleTimer = null; }
            if (typeof hub?.abortAgentPhoneSessions === "function") {
              try {
                hub.abortAgentPhoneSessions("voice-barge-in", {
                  conversationId: channelName,
                  conversationType: "channel",
                });
              } catch { /* ignore */ }
            }
          } else if (mode === 'conversation' && agentTurnActive && sessionPath) {
            agentTurnActive = false;
            try { void engine?.abortSession?.(sessionPath, { reason: "voice-barge-in" }); } catch { /* ignore */ }
          }
          // 丢弃未播报的段落与缓冲
          speakChain = Promise.resolve();
          speakBuffer = '';
          send({ type: "interrupt" });
          voiceState = 'listening';
        }
      }

      return {
        onOpen(_event: any, ws: any) {
          currentWs = ws;
        },
        onMessage(event: any, ws: any) {
          currentWs = ws;
          let msg: any;
          try { msg = JSON.parse(String(event.data)); } catch { return; }
          if (!msg || typeof msg.type !== "string") return;

          if (msg.type === "interrupt") { doInterrupt(); return; }

          if (msg.type === "start") {
            sampleRate = typeof msg.sampleRate === "number" && msg.sampleRate > 0 ? Math.round(msg.sampleRate) : 16000;
            mode = msg.mode === "conversation" ? "conversation" : "dictation";
            sessionPath = typeof msg.sessionPath === "string" && msg.sessionPath.trim() ? msg.sessionPath.trim() : "";
            channelName = typeof msg.channelName === "string" && msg.channelName.trim() ? msg.channelName.trim() : "";
            if (mode === "conversation") {
              if (channelName && sessionPath) {
                // 二者互斥:优先频道并提示
                sessionPath = '';
                send({ type: "error", message: "channelName and sessionPath are mutually exclusive; using channel" });
              } else if (!sessionPath && !channelName) {
                send({ type: "error", message: "conversation mode requires sessionPath or channelName" });
              }
            }
            atMs = 0;
            voiceState = 'listening';
            teardownChannel(false);
            session = new RealtimeVoiceSession({
              onVad: (state) => send({ type: "vad", state }),
              onUtterance: (payload) => void handleUtterance(payload, false),
              onMaxLengthReached: (payload) => void handleUtterance(payload, true),
              onInterim: (payload) => void handleInterim(payload),
            }, { sampleRate });
            send({ type: "ready", sampleRate, principal: requestContext?.principalId || null, mode });
          } else if (msg.type === "audio") {
            const pcm = typeof msg.data === "string" ? decodePcm(msg.data) : null;
            if (!pcm) return;
            if (voiceState === 'speaking' || voiceState === 'thinking') {
              // 播报/思考期间不喂 VAD(防止助手自己的声音被转写成新语句);
              // 仅在持续高能量(用户真实开口)时打断 barge-in;
              // 同时维护预滚,打断后用户话头不丢
              const frameMs = (pcm.length / sampleRate) * 1000;
              session?.feedPrerollOnly(pcm);
              if (computeRms(pcm) >= BARGE_IN_RMS) {
                bargeInMs += frameMs;
                if (bargeInMs >= BARGE_IN_MIN_MS) {
                  bargeInMs = 0;
                  doInterrupt();
                }
              } else {
                bargeInMs = 0;
              }
              return;
            }
            bargeInMs = 0;
            if (!session) return;
            session.feed(pcm, atMs);
            atMs += (pcm.length / sampleRate) * 1000;
          } else if (msg.type === "stop") {
            doInterrupt();
            teardownChannel(true);
            session?.flush();
            session?.close();
            session = null;
            voiceState = 'idle';
            send({ type: "ended" });
          }
        },
        onClose() {
          closed = true;
          doInterrupt();
          teardownChannel(false);
          if (session) { session.close(); session = null; }
          currentWs = null;
        },
      };
    }),
  );

  return route;
}

function decodePcm(base64: string): Int16Array | null {
  let buf: Buffer;
  try { buf = Buffer.from(base64, "base64"); } catch { return null; }
  if (!buf || buf.length === 0) return null;
  const n = Math.floor(buf.length / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}
