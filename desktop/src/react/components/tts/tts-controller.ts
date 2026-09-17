// desktop/src/react/components/tts/tts-controller.ts
// 模块级 TTS 播放控制器。
// 首选 /api/speech-generation/synthesize-stream(SSE) + MediaSource 流式播放,
// 避免整段 base64 data URL 超过 Chromium GURL 2MB 上限导致的长文本播放失败;
// MediaSource 不可用时回退 /api/speech-generation/synthesize 一次性 dataUrl 播放。
import { jarvisFetch } from '../../hooks/use-jarvis-fetch';

export interface TtsPlayState {
  playing: boolean;
  messageId: string | null;
  error: string | null;
}

type Listener = (s: TtsPlayState) => void;

export interface SpeakOptions {
  messageId?: string;
  providerId?: string;
  modelId?: string;
  voice?: string;
  rate?: number | string;
}

/** 朗读前去掉 Markdown 符号,避免把星号/反引号念出来。 */
export function stripMarkdownForSpeech(text: string): string {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^>[^\n]*$/gm, ' ')
    .replace(/^[#>\s-]+/gm, ' ')
    .replace(/[*_~|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

let state: TtsPlayState = { playing: false, messageId: null, error: null };
let audio: HTMLAudioElement | null = null;
let streamAbort: AbortController | null = null;
let streamMediaSource: MediaSource | null = null;
let streamObjectUrl: string | null = null;
// 代际标记:stopInternal 递增,异步回调据此判断是否已被新的播放/停止取代
let gen = 0;
const listeners = new Set<Listener>();

// MediaSource 流式播放参数(与 use-realtime-voice 一致)
const MS_PREBUFFER_SEC = 0.3;
const MS_MAX_START_WAIT_MS = 1500;
// 流式请求是长连接,放宽到 10 分钟(停止时由 AbortController 主动中断)
const STREAM_TIMEOUT_MS = 10 * 60_000;

function emit() {
  const snapshot: TtsPlayState = { ...state };
  for (const listener of listeners) listener(snapshot);
}

export function subscribeTts(listener: Listener): () => void {
  listeners.add(listener);
  listener({ ...state });
  return () => { listeners.delete(listener); };
}

export function getTtsState(): TtsPlayState {
  return { ...state };
}

/** i18n 取值,缺翻译时回退默认中文(window.t 未注入时也能工作)。 */
function tr(key: string, fallback: string): string {
  const v = typeof window !== 'undefined' ? window.t?.(key) : undefined;
  return v && v !== key ? v : fallback;
}

function stopInternal() {
  gen += 1;
  if (streamAbort) {
    try { streamAbort.abort(); } catch { /* ignore */ }
    streamAbort = null;
  }
  if (audio) {
    try { audio.onended = null; audio.onerror = null; audio.pause(); } catch { /* ignore */ }
    audio = null;
  }
  if (streamMediaSource) {
    try { if (streamMediaSource.readyState === 'open') streamMediaSource.endOfStream(); } catch { /* ignore */ }
    streamMediaSource = null;
  }
  if (streamObjectUrl) {
    try { URL.revokeObjectURL(streamObjectUrl); } catch { /* ignore */ }
    streamObjectUrl = null;
  }
  if (state.playing || state.messageId || state.error) {
    state = { playing: false, messageId: null, error: null };
    emit();
  }
}

export function stopTts() {
  stopInternal();
}

function supportsStreamingPlayback(): boolean {
  try {
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');
  } catch { return false; }
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 播放阶段错误 → 用户友好文案;真实细节进 console 便于排查。 */
function friendlyPlaybackError(detail: unknown): string {
  const name = (detail as { name?: unknown })?.name;
  if (name === 'NotAllowedError') {
    return tr('tts.playbackNotAllowed', '浏览器限制了自动播放，请再点击一次');
  }
  return tr('tts.playbackError', '语音播放失败');
}

/** 合成阶段错误 → 用户友好文案(保留原有映射)。 */
function friendlySynthesisError(err: unknown): string {
  const errMsg = String((err as { message?: unknown })?.message || 'ttsFailed');
  return errMsg.includes('no audio received')
    ? '语音合成失败：无法连接到微软服务（网络被拦截）'
    : errMsg.includes('not configured') || errMsg.includes('model is not configured')
    ? '语音合成失败：未配置语音模型（请在设置中配置）'
    : errMsg.includes('not found') || errMsg.includes('binary not found')
    ? '语音合成失败：未找到本地引擎（请在设置中配置 Sherpa 路径）'
    : '语音合成失败：' + errMsg;
}

export async function speakTts(text: string, opts: SpeakOptions = {}): Promise<void> {
  const msgId = opts.messageId || null;
  stopInternal();
  const trimmed = (text || '').trim();
  if (!trimmed) return;

  const payload = {
    text: trimmed,
    providerId: opts.providerId,
    modelId: opts.modelId,
    voice: opts.voice,
    rate: opts.rate,
  };

  if (supportsStreamingPlayback()) {
    const streamed = await speakStreaming(payload, msgId);
    if (streamed) return;
    // 流式链路失败(网络/服务端不支持等) → 回退一次性合成
  }
  await speakOnce(payload, msgId);
}

interface SpeakPayload {
  text: string;
  providerId?: string;
  modelId?: string;
  voice?: string;
  rate?: number | string;
}


/**
 * 流式播放:SSE 收 MP3 分块 → MediaSource 连续解码。
 * 返回 true 表示本次请求已处理(成功播放或被用户停止);返回 false 表示应回退一次性合成。
 */
async function speakStreaming(payload: SpeakPayload, msgId: string | null): Promise<boolean> {
  const myGen = gen;
  const controller = new AbortController();
  streamAbort = controller;
  try {
    const res = await jarvisFetch('/api/speech-generation/synthesize-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: STREAM_TIMEOUT_MS,
      throwOnHttpError: false,
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(String((data as { error?: unknown })?.error || `tts stream failed (${res.status})`));
    }
    if (!res.body) throw new Error('tts stream: response has no body');
    await playSseStream(res.body, msgId, myGen);
    return true;
  } catch (err) {
    if (controller.signal.aborted || myGen !== gen) return true; // 被用户停止/新播放取代
    console.warn('[tts] streaming playback failed, falling back to one-shot synthesize:', err);
    // 流可能已部分播放:停掉残留音频资源,由回退路径重新播放
    if (audio) { try { audio.onended = null; audio.onerror = null; audio.pause(); } catch { /* ignore */ } audio = null; }
    if (streamMediaSource) { try { if (streamMediaSource.readyState === 'open') streamMediaSource.endOfStream(); } catch { /* ignore */ } streamMediaSource = null; }
    if (streamObjectUrl) { try { URL.revokeObjectURL(streamObjectUrl); } catch { /* ignore */ } streamObjectUrl = null; }
    return false;
  } finally {
    if (streamAbort === controller) streamAbort = null;
  }
}

/** 读取 SSE 流并把 MP3 块喂给 MediaSource;流结束时 promise 返回(音频继续播到 onended)。 */
async function playSseStream(body: ReadableStream<Uint8Array>, msgId: string | null, myGen: number): Promise<void> {
  const mediaSource = new MediaSource();
  streamMediaSource = mediaSource;
  const el = new Audio();
  audio = el;
  const objectUrl = URL.createObjectURL(mediaSource);
  streamObjectUrl = objectUrl;
  el.src = objectUrl;

  let sourceBuffer: SourceBuffer | null = null;
  const queue: Uint8Array[] = [];
  let streamDone = false;
  let started = false;
  let firstChunkAt = 0;
  let playbackFailed = false;

  const failPlayback = (detail: unknown) => {
    if (playbackFailed) return;
    playbackFailed = true;
    console.warn('[tts] playback error:', detail);
    if (myGen !== gen) return;
    state = { playing: false, messageId: msgId, error: friendlyPlaybackError(detail) };
    emit();
  };

  const startPlayback = () => {
    if (started || playbackFailed) return;
    started = true;
    if (myGen === gen) {
      state = { playing: true, messageId: msgId, error: null };
      emit();
    }
    el.play().catch(failPlayback);
  };

  const maybeStart = () => {
    if (started || playbackFailed) return;
    let buffered = 0;
    try {
      if (el.buffered.length > 0) {
        buffered = el.buffered.end(el.buffered.length - 1) - el.currentTime;
      }
    } catch { /* ignore */ }
    const waited = performance.now() - (firstChunkAt || performance.now());
    if (buffered >= MS_PREBUFFER_SEC || waited >= MS_MAX_START_WAIT_MS) startPlayback();
  };

  const drain = () => {
    if (myGen !== gen || playbackFailed) return;
    if (!sourceBuffer || sourceBuffer.updating) return;
    if (queue.length > 0) {
      const chunk = queue.shift()!;
      try {
        sourceBuffer.appendBuffer(chunk.buffer as ArrayBuffer);
      } catch {
        // 追加冲突/失败:放回队首,等下一个 updateend 再试
        queue.unshift(chunk);
      }
      return;
    }
    // 短回复可能在达到预缓冲阈值前流就结束了:结束前必须强制开播,否则会静默
    if (streamDone && !started) startPlayback();
    if (streamDone) {
      try { if (mediaSource.readyState === 'open') mediaSource.endOfStream(); } catch { /* ignore */ }
      return;
    }
    maybeStart();
  };

  el.onended = () => { if (myGen === gen) stopInternal(); };
  el.onerror = () => {
    if (myGen !== gen) return;
    failPlayback(new Error(`MediaError code=${el.error?.code ?? 'unknown'}`));
  };

  await new Promise<void>((resolve, reject) => {
    let streamError: Error | null = null;

    mediaSource.addEventListener('sourceopen', () => {
      if (myGen !== gen) { resolve(); return; }
      try {
        sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
        sourceBuffer.addEventListener('updateend', drain);
        drain();
      } catch (err) { reject(err); }
    });

    const handleSseEvent = (raw: string) => {
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) return;
      if (event === 'chunk') {
        try {
          const parsed = JSON.parse(data) as { data?: string };
          const bytes = parsed.data ? base64ToUint8(parsed.data) : null;
          if (bytes && bytes.length) {
            if (!firstChunkAt) firstChunkAt = performance.now();
            queue.push(bytes);
            drain();
          }
        } catch { /* 单块解析失败不中断整段 */ }
      } else if (event === 'error') {
        try {
          const parsed = JSON.parse(data) as { message?: string };
          streamError = new Error(parsed.message || 'tts stream error');
        } catch {
          streamError = new Error('tts stream error');
        }
      } else if (event === 'end') {
        streamDone = true;
        drain();
      }
    };

    (async () => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleSseEvent(rawEvent);
          if (streamError) throw streamError;
        }
      }
      if (streamError) throw streamError;
      streamDone = true;
      drain();
    })().then(() => resolve(), reject);
  });
}

/** 一次性合成 + dataUrl 播放(MediaSource 不可用时的回退;短消息适用)。 */
async function speakOnce(payload: SpeakPayload, msgId: string | null): Promise<void> {
  const myGen = gen;
  try {
    const res = await jarvisFetch('/api/speech-generation/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 60_000,
      // 让我们手动解析错误响应体，以便把服务端的真实错误原因透出给用户
      throwOnHttpError: false,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String((data as { error?: unknown })?.error || `tts failed (${res.status})`));
    const url = (data as { audio?: { dataUrl?: string }; error?: unknown })?.audio?.dataUrl;
    if (!url) throw new Error(String((data as { error?: unknown })?.error || 'tts failed: no audio'));
    if (myGen !== gen) return;

    const el = new Audio(url);
    audio = el;
    state = { playing: true, messageId: msgId, error: null };
    emit();

    el.onended = () => { if (myGen === gen) stopInternal(); };
    el.onerror = () => {
      console.warn('[tts] audio element error: code=', el.error?.code, 'dataUrl length=', url.length);
      if (myGen !== gen) return;
      state = { playing: false, messageId: msgId, error: tr('tts.playbackError', '语音播放失败') };
      emit();
    };

    await el.play().catch((err) => {
      console.warn('[tts] audio play() rejected:', err);
      if (myGen !== gen) return;
      state = { playing: false, messageId: msgId, error: friendlyPlaybackError(err) };
      emit();
    });
  } catch (err) {
    if (myGen !== gen) return;
    state = { playing: false, messageId: msgId, error: friendlySynthesisError(err) };
    emit();
  }
}

