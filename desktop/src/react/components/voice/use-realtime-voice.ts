// desktop/src/react/components/voice/use-realtime-voice.ts
// 免提实时语音:采集麦克风 → 以 Int16 PCM 帧流式上行到 /api/voice → 回调 final / VAD / TTS 播放。
//
// TTS 播放:
// - 麦克风采集与播放使用独立资源:打断播报只停播放,不影响采集;
// - MP3(Edge)走 MediaSource 连续解码 + 起播预缓冲,一轮对话一个解码流,
//   消除逐块独立解码的边界毛刺与到达抖动造成的"闪断";
// - WAV(sherpa 本地)按分段整段解码、链式调度;
// - MediaSource 不可用时回退逐块 decodeAudioData 调度方案。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../stores';
import {
  buildConnectionWsUrl,
  requestConnectionWsTicket,
  requireServerConnection,
} from '../../services/server-connection';

export interface RealtimeVoiceHandlers {
  onFinal?: (text: string, meta: { durationMs?: number; truncated?: boolean }) => void;
  onVad?: (state: 'speech' | 'silence') => void;
  onError?: (message: string) => void;
  /** 流式中间结果:说话过程中实时识别文本 */
  onInterim?: (text: string) => void;
  /** 全双工:TTS 开始播放 */
  onTtsStart?: (id: string, text: string) => void;
  /** 全双工:TTS 结束播放 */
  onTtsEnd?: (id: string) => void;
  /** 全双工:收到打断信号 */
  onInterrupt?: () => void;
  /** 全双工:正在思考/合成 */
  onThinking?: () => void;
  /** 语音对话:Agent 回复增量(回复本身经聊天窗口流式呈现,此回调供附加 UI 消费) */
  onAgentDelta?: (delta: string) => void;
  /** 频道语音对话:用户语音消息已写入频道的回显(渲染端据此更新频道消息列表) */
  onChannelMessageSent?: (msg: { channel: string; sender: string; timestamp: string; body: string }) => void;
}

export interface RealtimeVoiceStartOptions {
  /** dictation(默认):仅转写;conversation:识别文本发给 Agent 并 TTS 播报回复。 */
  mode?: 'dictation' | 'conversation';
  /** conversation 目标(1:1 会话):当前聊天会话路径。与 channelName 互斥。 */
  sessionPath?: string;
  /** conversation 目标(频道群聊):说话即发频道消息,成员回复到达即播报。与 sessionPath 互斥。 */
  channelName?: string;
}

export type RealtimeVoiceState = 'idle' | 'starting' | 'listening' | 'speech' | 'thinking' | 'speaking';

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 2048;
// 调度起点提前量(秒):解码有耗时,起播点不贴着当前时刻
const SCHEDULE_LEAD_SEC = 0.06;
// MP3 流式播放(MediaSource)起播预缓冲:攒够该时长再 play,
// 吸收 WebSocket 分块到达抖动,避免起播即卡顿
const MS_PREBUFFER_SEC = 0.35;
// 预缓冲最长等待(毫秒):稀疏流下兜底起播
const MS_MAX_START_WAIT_MS = 1200;

/** 一轮对话共用的 MP3 连续解码流(MediaSource)。 */
interface TtsMediaState {
  audio: HTMLAudioElement;
  mediaSource: MediaSource;
  sourceBuffer: SourceBuffer | null;
  queue: Uint8Array[];
  done: boolean;
  started: boolean;
  firstChunkAt: number;
  gen: number;
}

export function useRealtimeVoice(handlers: RealtimeVoiceHandlers = {}) {
  const [state, setState] = useState<RealtimeVoiceState>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const ttsCtxRef = useRef<AudioContext | null>(null);
  // ttsGen 用于作废过期的异步解码回调(interrupt/新一段播报后到达的块)
  const ttsGenRef = useRef(0);
  const ttsDecodeChainRef = useRef<Promise<void>>(Promise.resolve());
  const ttsScheduledUntilRef = useRef(0);
  const ttsActiveSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const ttsWavPartsRef = useRef<Uint8Array[]>([]);
  const ttsFormatRef = useRef<'mp3' | 'wav' | null>(null);
  const ttsMediaRef = useRef<TtsMediaState | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const sendFrame = useCallback((pcm: Int16Array) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'audio', data: int16ToBase64(pcm) }));
  }, []);

  /** 立即停止所有 TTS 播放并作废排队中的块。 */
  const stopAllTts = useCallback(() => {
    ttsGenRef.current += 1;
    ttsDecodeChainRef.current = Promise.resolve();
    ttsScheduledUntilRef.current = 0;
    ttsWavPartsRef.current = [];
    ttsFormatRef.current = null;
    for (const src of ttsActiveSourcesRef.current) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    ttsActiveSourcesRef.current = [];
  }, []);

  /** 立即销毁 MP3 流(MediaSource),释放 audio 元素与 objectURL。 */
  const destroyMsPlayback = useCallback(() => {
    const media = ttsMediaRef.current;
    ttsMediaRef.current = null;
    if (!media) return;
    try { media.audio.pause(); } catch { /* ignore */ }
    try { media.mediaSource.endOfStream(); } catch { /* ignore */ }
    try { URL.revokeObjectURL(media.audio.src); } catch { /* ignore */ }
  }, []);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
    try { processorRef.current?.disconnect(); } catch { /* ignore */ }
    processorRef.current = null;
    try { micCtxRef.current?.close(); } catch { /* ignore */ }
    micCtxRef.current = null;
    stopAllTts();
    destroyMsPlayback();
    if (ttsCtxRef.current) { try { void ttsCtxRef.current.close(); } catch { /* ignore */ } ttsCtxRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState('idle');
  }, [stopAllTts, destroyMsPlayback]);

  useEffect(() => () => { stop(); }, [stop]);

  /** 按顺序调度一个解码后的音频块:与已排队块首尾相接,消除乱序与重叠。 */
  const scheduleBuffer = (buffer: AudioBuffer, gen: number) => {
    const ctx = ttsCtxRef.current;
    if (!ctx || gen !== ttsGenRef.current) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const now = ctx.currentTime;
    if (ttsScheduledUntilRef.current < now + SCHEDULE_LEAD_SEC) {
      ttsScheduledUntilRef.current = now + SCHEDULE_LEAD_SEC;
    }
    source.start(ttsScheduledUntilRef.current);
    ttsScheduledUntilRef.current += buffer.duration;
    ttsActiveSourcesRef.current.push(source);
    source.onended = () => {
      ttsActiveSourcesRef.current = ttsActiveSourcesRef.current.filter((s) => s !== source);
    };
  };

  /** 串行解码入队,保证 MP3 分块按到达顺序播放。 */
  const decodeAndSchedule = (bytes: Uint8Array) => {
    const gen = ttsGenRef.current;
    const ctx = ttsCtxRef.current;
    if (!ctx) return;
    const copy = new Uint8Array(bytes);
    ttsDecodeChainRef.current = ttsDecodeChainRef.current
      .then(async () => {
        if (gen !== ttsGenRef.current) return;
        const buffer = await ctx.decodeAudioData(copy.buffer as ArrayBuffer);
        scheduleBuffer(buffer, gen);
      })
      .catch(() => { /* 单块解码失败不中断整段 */ });
  };

  // ── MP3 流式播放(MediaSource):整轮一个连续解码流 ──
  // 逐块独立 decodeAudioData 会在每个分块边界留下解码器毛刺,且调度提前量
  // 抗不住到达抖动;MediaSource 让 <audio> 连续解码并自带缓冲,消除"闪"。

  const drainMsPlayback = (media: TtsMediaState) => {
    if (ttsMediaRef.current !== media) return;
    const sb = media.sourceBuffer;
    if (!sb || sb.updating) return;
    if (media.queue.length > 0) {
      const chunk = media.queue.shift()!;
      try {
        sb.appendBuffer(chunk.buffer as ArrayBuffer);
      } catch {
        // 追加冲突/失败:放回队首,等下一个 updateend 再试
        media.queue.unshift(chunk);
      }
      return;
    }
    if (media.done) {
      try { media.mediaSource.endOfStream(); } catch { /* ignore */ }
      return;
    }
    maybeStartMsPlayback(media);
  };

  const maybeStartMsPlayback = (media: TtsMediaState) => {
    if (media.started) return;
    let buffered = 0;
    try {
      if (media.audio.buffered.length > 0) {
        buffered = media.audio.buffered.end(media.audio.buffered.length - 1) - media.audio.currentTime;
      }
    } catch { /* ignore */ }
    const waited = performance.now() - (media.firstChunkAt || performance.now());
    if (buffered >= MS_PREBUFFER_SEC || waited >= MS_MAX_START_WAIT_MS) {
      media.started = true;
      media.audio.play().catch(() => { /* autoplay 受限或流已结束,静默 */ });
    }
  };

  const ensureMsPlayback = (gen: number): TtsMediaState | null => {
    if (typeof MediaSource === 'undefined') return null;
    try {
      if (!MediaSource.isTypeSupported('audio/mpeg')) return null;
    } catch { return null; }
    if (ttsMediaRef.current && ttsMediaRef.current.gen === gen) return ttsMediaRef.current;
    destroyMsPlayback();
    try {
      const mediaSource = new MediaSource();
      const audio = new Audio();
      audio.src = URL.createObjectURL(mediaSource);
      const media: TtsMediaState = {
        audio, mediaSource, sourceBuffer: null,
        queue: [], done: false, started: false, firstChunkAt: 0, gen,
      };
      ttsMediaRef.current = media;
      mediaSource.addEventListener('sourceopen', () => {
        if (ttsMediaRef.current !== media) return;
        try {
          const sb = mediaSource.addSourceBuffer('audio/mpeg');
          media.sourceBuffer = sb;
          sb.addEventListener('updateend', () => drainMsPlayback(media));
          drainMsPlayback(media);
        } catch { /* addSourceBuffer 失败:后续块走 decodeAudioData 回退 */ }
      });
      return media;
    } catch { return null; }
  };

  const appendMp3Chunk = (bytes: Uint8Array) => {
    const media = ensureMsPlayback(ttsGenRef.current);
    if (!media) { decodeAndSchedule(bytes); return; }
    if (!media.firstChunkAt) media.firstChunkAt = performance.now();
    media.queue.push(bytes);
    drainMsPlayback(media);
  };

  /** 回合真正结束(agent_turn_end)才 endOfStream;分段的 tts_end 不关流。 */
  const finishMsPlayback = () => {
    const media = ttsMediaRef.current;
    if (!media) return;
    media.done = true;
    drainMsPlayback(media);
  };

  const start = useCallback(async (options: RealtimeVoiceStartOptions = {}) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      handlersRef.current.onError?.('mic unavailable');
      return;
    }
    setState('starting');
    try {
      const connection = requireServerConnection(useStore.getState(), 'realtime voice: server not ready');
      const wsTicket = await requestConnectionWsTicket(connection);
      const url = buildConnectionWsUrl(connection, '/api/voice', { wsTicket });
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = async () => {
        ws.send(JSON.stringify({
          type: 'start',
          sampleRate: TARGET_SAMPLE_RATE,
          mode: options.mode === 'conversation' ? 'conversation' : 'dictation',
          ...(options.channelName
            ? { channelName: options.channelName }
            : options.sessionPath
              ? { sessionPath: options.sessionPath }
              : {}),
        }));
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          streamRef.current = stream;
          const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
          micCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const processor = ctx.createScriptProcessor(FRAME_SIZE, 1, 1);
          processorRef.current = processor;
          processor.onaudioprocess = (e) => {
            const channel = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(channel.length);
            for (let i = 0; i < channel.length; i++) {
              const s = Math.max(-1, Math.min(1, channel[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            sendFrame(int16);
          };
          source.connect(processor);
          processor.connect(ctx.destination);
          setState('listening');
        } catch (err) {
          handlersRef.current.onError?.(String((err as { message?: unknown })?.message || 'mic start failed'));
        }
      };

      ws.onmessage = (event) => {
        let msg: any;
        try { msg = JSON.parse(String(event.data)); } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === 'vad') {
          setState(msg.state === 'speech' ? 'speech' : 'listening');
          handlersRef.current.onVad?.(msg.state);
        } else if (msg.type === 'interim') {
          if (typeof msg.text === 'string' && msg.text.length > 0) {
            handlersRef.current.onInterim?.(msg.text);
          }
        } else if (msg.type === 'final') {
          if (typeof msg.text === 'string' && msg.text.length > 0) {
            handlersRef.current.onFinal?.(msg.text, { durationMs: msg.durationMs, truncated: !!msg.truncated });
          }
        } else if (msg.type === 'thinking') {
          // 新回合开始:清空上一回合的播放队列与 MP3 解码流
          stopAllTts();
          destroyMsPlayback();
          setState('thinking');
          handlersRef.current.onThinking?.();
        } else if (msg.type === 'agent_delta') {
          if (typeof msg.delta === 'string' && msg.delta.length > 0) {
            handlersRef.current.onAgentDelta?.(msg.delta);
          }
        } else if (msg.type === 'channel_message_sent') {
          handlersRef.current.onChannelMessageSent?.({
            channel: String(msg.channel || ''),
            sender: String(msg.sender || 'user'),
            timestamp: String(msg.timestamp || ''),
            body: String(msg.body || ''),
          });
        } else if (msg.type === 'tts_start') {
          // 注意:不清队列 — 按句切分时上一段可能还在播,分段间首尾相接
          setState('speaking');
          handlersRef.current.onTtsStart?.(msg.id, msg.text || '');
          if (!ttsCtxRef.current) { try { ttsCtxRef.current = new AudioContext(); } catch { /* ignore */ } }
        } else if (msg.type === 'tts_audio') {
          if (typeof msg.data !== 'string' || !ttsCtxRef.current) return;
          try {
            const binary = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
            if (ttsFormatRef.current === null) {
              // 嗅探首块:RIFF 头 → WAV(sherpa 等本地引擎,需整段解码);否则按 MP3 逐块解码
              ttsFormatRef.current = isRiff(binary) ? 'wav' : 'mp3';
            }
            if (ttsFormatRef.current === 'wav') {
              ttsWavPartsRef.current.push(binary);
            } else {
              appendMp3Chunk(binary);
            }
          } catch { /* ignore */ }
        } else if (msg.type === 'tts_end') {
          if (ttsFormatRef.current === 'wav' && ttsWavPartsRef.current.length > 0) {
            const total = concatBytes(ttsWavPartsRef.current);
            ttsWavPartsRef.current = [];
            decodeAndSchedule(total);
          }
          // MP3 流不在此收尾:后续分段继续追加,agent_turn_end 才 endOfStream
          handlersRef.current.onTtsEnd?.(msg.id || '');
          // 不切回 listening:后续分段可能仍在排队,等 agent_turn_end
        } else if (msg.type === 'agent_turn_end') {
          finishMsPlayback();
          setState('listening');
        } else if (msg.type === 'interrupt') {
          stopAllTts();
          destroyMsPlayback();
          setState('listening');
          handlersRef.current.onInterrupt?.();
        } else if (msg.type === 'error') {
          handlersRef.current.onError?.(String(msg.message || 'voice error'));
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          // 连接断开:释放麦克风与播放资源,避免采集残留
          stop();
        }
      };
      ws.onerror = () => {
        handlersRef.current.onError?.('voice ws error');
      };
    } catch (err) {
      setState('idle');
      handlersRef.current.onError?.(String((err as { message?: unknown })?.message || 'voice start failed'));
    }
  }, [sendFrame, stop, stopAllTts]);

  return { state, start, stop };
}

function isRiff(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
