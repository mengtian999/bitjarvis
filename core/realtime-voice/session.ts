/**
 * RealtimeVoiceSession — 免提（hands-free）VAD 端点检测会话。
 *
 * 输入为连续 Int16 PCM 分帧；用能量（RMS）做语音/静音判断，把一段连续语音累积为
 * WAV 基线并回调 onUtterance。不依赖任何语音引擎，可独立测试。
 */
import { randomUUID } from "node:crypto";

export interface RealtimeVoiceEvents {
  onVad: (state: "speech" | "silence") => void;
  onUtterance: (payload: { id: string; wavBase64: string; durationMs: number; sampleRate: number }) => void;
  onMaxLengthReached: (payload: { id: string; wavBase64: string; durationMs: number; sampleRate: number }) => void;
  /** 流式中间结果：说话过程中的定期识别结果，带当前累积音频 */
  onInterim?: (payload: { id: string; wavBase64: string; durationMs: number; sampleRate: number }) => void;
}

export interface RealtimeVoiceOptions {
  sampleRate?: number;
  /** 判定为一帧语音的 RMS 阈值（Int16）。默认 1400。 */
  speechThreshold?: number;
  /** 静音持续至少多少毫秒即判定说话结束。默认 900。 */
  silenceMs?: number;
  /** 单段语音最长时间，超时强制切段。默认 15000。 */
  maxUtteranceMs?: number;
  /** 流式中间结果的发送间隔（毫秒）。默认 500。设为 0 禁用。 */
  interimIntervalMs?: number;
  /** 预滚缓冲（毫秒）：语音能量达到阈值前保留最近一段音频并计入语句，
   *  防止首字/音节起始被切掉导致识别率下降。默认 300，设为 0 禁用。 */
  prerollMs?: number;
}

export class RealtimeVoiceSession {
  private _events: RealtimeVoiceEvents;
  private _opts: Required<RealtimeVoiceOptions>;
  private _frames: number[] = [];
  private _speech = false;
  private _silenceStartMs = 0;
  private _utterStartMs = 0;
  private _sampleDurMs = 0;
  private _closed = false;
  private _lastInterimMs = 0;
  private _utterId = "";
  private _prerollFrames: number[][] = [];
  private _prerollFrameMs: number[] = [];
  private _prerollMs = 0;

  constructor(events: RealtimeVoiceEvents, options: RealtimeVoiceOptions = {}) {
    this._events = events;
    this._opts = {
      sampleRate: options.sampleRate ?? 16000,
      speechThreshold: options.speechThreshold ?? 1400,
      silenceMs: options.silenceMs ?? 900,
      maxUtteranceMs: options.maxUtteranceMs ?? 15000,
      interimIntervalMs: options.interimIntervalMs ?? 500,
      prerollMs: options.prerollMs ?? 300,
    };
  }

  /** 送回采样率（用于校验/校正）。 */
  get sampleRate() { return this._opts.sampleRate; }

  reset() {
    this._frames = [];
    this._speech = false;
    this._silenceStartMs = 0;
    this._utterStartMs = 0;
    this._lastInterimMs = 0;
    this._prerollFrames = [];
    this._prerollFrameMs = [];
    this._prerollMs = 0;
  }

  /** 静音期保留最近 prerollMs 的帧,供语音触发时回补语句开头。 */
  private _pushPreroll(pcm: ArrayLike<number>, frameMs: number) {
    if (this._opts.prerollMs <= 0) return;
    const copy = new Array<number>(pcm.length);
    for (let i = 0; i < pcm.length; i++) copy[i] = pcm[i];
    this._prerollFrames.push(copy);
    this._prerollFrameMs.push(frameMs);
    this._prerollMs += frameMs;
    while (this._prerollMs > this._opts.prerollMs && this._prerollFrames.length > 1) {
      this._prerollMs -= this._prerollFrameMs.shift()!;
      this._prerollFrames.shift();
    }
  }

  private _flushPrerollIntoUtterance() {
    for (const frame of this._prerollFrames) appendFrames(this._frames, frame);
    this._prerollFrames = [];
    this._prerollFrameMs = [];
    this._prerollMs = 0;
  }

  /**
   * 喂入一小段 Int16 PCM 帧。
   * @param pcm   Int16 PCM（平台字节序的副本）
   * @param atMs  该帧的时间位置（毫秒），用于静音/时长判定
   */
  feed(pcm: ArrayLike<number>, atMs: number) {
    if (this._closed || !pcm || pcm.length === 0) return;
    const frameMs = (pcm.length / this._opts.sampleRate) * 1000;
    const rms = computeRms(pcm);
    const isSpeech = rms >= this._opts.speechThreshold;

    if (isSpeech) {
      if (!this._speech) {
        this._speech = true;
        this._silenceStartMs = 0;
        this._utterStartMs = atMs;
        this._lastInterimMs = atMs;
        this._utterId = randomUUID();
        // 回补语音达到阈值前的音频,避免首字/音节起始被切掉
        this._flushPrerollIntoUtterance();
        this._emitVad("speech");
      }
      appendFrames(this._frames, pcm);
      // 定期触发流式中间结果
      this._maybeFireInterim(atMs);
    } else if (this._speech) {
      appendFrames(this._frames, pcm);
      if (!this._silenceStartMs) this._silenceStartMs = atMs;
      const silenceMs = atMs + frameMs - this._silenceStartMs;
      if (silenceMs >= this._opts.silenceMs) this._endUtterance(false);
      else if (atMs - this._utterStartMs + frameMs >= this._opts.maxUtteranceMs) this._endUtterance(true);
    } else {
      // 静音期累积预滚缓冲
      this._pushPreroll(pcm, frameMs);
    }
  }

  /** 仅维护预滚缓冲,不进入 VAD/语句累积。
   *  用于助手播报期间:打断(barge-in)后回到 listening 时,用户触发打断的
   *  话语起始已在预滚中,不会丢失开头。 */
  feedPrerollOnly(pcm: ArrayLike<number>) {
    if (this._closed || !pcm || pcm.length === 0) return;
    const frameMs = (pcm.length / this._opts.sampleRate) * 1000;
    this._pushPreroll(pcm, frameMs);
  }

  /** 主动结束（如用户在 UI 上点停止）。 */
  flush() {
    this._endUtterance(false);
  }

  close() { this._closed = true; this.reset(); }

  private _endUtterance(maxReached: boolean) {
    if (this._closed) return;
    const raw = this._frames;
    this._frames = [];
    const wasSpeech = this._speech;
    this._speech = false;
    this._silenceStartMs = 0;
    this._emitVad("silence");
    if (!wasSpeech || raw.length === 0) return;

    const int16 = new Int16Array(raw.length);
    for (let i = 0; i < raw.length; i++) int16[i] = raw[i];
    const wavBase64 = encodeWavFromInt16(int16, this._opts.sampleRate);
    const payload = {
      id: randomUUID(),
      wavBase64,
      durationMs: Math.round((int16.length / this._opts.sampleRate) * 1000),
      sampleRate: this._opts.sampleRate,
    };
    if (maxReached) this._events.onMaxLengthReached?.(payload);
    else this._events.onUtterance(payload);
  }

  private _emitVad(state: "speech" | "silence") {
    this._events.onVad?.(state);
  }

  private _maybeFireInterim(atMs: number) {
    const interval = this._opts.interimIntervalMs;
    if (!interval || !this._events.onInterim) return;
    if (atMs - this._lastInterimMs < interval) return;
    this._lastInterimMs = atMs;
    const raw = this._frames;
    if (raw.length === 0) return;
    const int16 = new Int16Array(raw.length);
    for (let i = 0; i < raw.length; i++) int16[i] = raw[i];
    const wavBase64 = encodeWavFromInt16(int16, this._opts.sampleRate);
    this._events.onInterim({
      id: this._utterId,
      wavBase64,
      durationMs: Math.round((int16.length / this._opts.sampleRate) * 1000),
      sampleRate: this._opts.sampleRate,
    });
  }
}

/** 帧能量(Int16 RMS),供路由层做 barge-in 等能量判断复用。 */
export function computeRms(pcm: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) { const v = pcm[i]; sum += v * v; }
  return Math.sqrt(sum / Math.max(1, pcm.length));
}

function appendFrames(target: number[], pcm: ArrayLike<number>) {
  for (let i = 0; i < pcm.length; i++) target.push(pcm[i]);
}

/** 将 Int16 PCM 编码为 44 字节 WAV 头 + PCM，返回 base64。 */
export function encodeWavFromInt16(pcm: Int16Array, sampleRate: number): string {
  const dataSize = pcm.length * 2;
  const buffer = new Uint8Array(44 + dataSize);
  const dv = new DataView(buffer.buffer);
  writeAscii(buffer, 0, "RIFF");
  dv.setUint32(4, 36 + dataSize, true);
  writeAscii(buffer, 8, "WAVE");
  writeAscii(buffer, 12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeAscii(buffer, 36, "data");
  dv.setUint32(40, dataSize, true);
  const view = new DataView(buffer.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString("base64");
}

function writeAscii(buf: Uint8Array, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) buf[offset + i] = text.charCodeAt(i);
}
