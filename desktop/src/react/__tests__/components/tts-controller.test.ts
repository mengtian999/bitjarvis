// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/use-jarvis-fetch', () => ({
  jarvisFetch: vi.fn(),
}));

import { jarvisFetch } from '../../hooks/use-jarvis-fetch';
import {
  getTtsState,
  speakTts,
  stopTts,
  stripMarkdownForSpeech,
} from '../../components/tts/tts-controller';

const mockedJarvisFetch = vi.mocked(jarvisFetch);

class FakeAudio {
  static instances: FakeAudio[] = [];
  static rejectPlayWith: Error | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: { code?: number } | null = null;
  currentTime = 0;
  buffered = { length: 0, end: () => 0 };
  play = vi.fn<() => Promise<void>>(() => (
    FakeAudio.rejectPlayWith ? Promise.reject(FakeAudio.rejectPlayWith) : Promise.resolve()
  ));
  pause = vi.fn();
  constructor(public src?: string) {
    FakeAudio.instances.push(this);
  }
}

class FakeSourceBuffer extends EventTarget {
  updating = false;
  appended: ArrayBuffer[] = [];
  appendBuffer(buf: ArrayBuffer) {
    this.appended.push(buf);
    queueMicrotask(() => {
      if (!this.updating) this.dispatchEvent(new Event('updateend'));
    });
  }
}

class FakeMediaSource extends EventTarget {
  static instances: FakeMediaSource[] = [];
  static isTypeSupported = vi.fn(() => true);
  readyState = 'open';
  sourceBuffer = new FakeSourceBuffer();
  constructor() {
    super();
    FakeMediaSource.instances.push(this);
    queueMicrotask(() => this.dispatchEvent(new Event('sourceopen')));
  }
  addSourceBuffer() {
    return this.sourceBuffer;
  }
  endOfStream() {
    this.readyState = 'ended';
  }
}

function sseResponseBody(payload: string) {
  const bytes = new TextEncoder().encode(payload);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function synthesizeOkResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ audio: { dataUrl: 'data:audio/mpeg;base64,AAAA' } }),
  } as unknown as Response;
}

beforeEach(() => {
  mockedJarvisFetch.mockReset();
  FakeAudio.instances = [];
  FakeAudio.rejectPlayWith = null;
  FakeMediaSource.instances = [];
  (globalThis as { Audio?: unknown }).Audio = FakeAudio;
  delete (globalThis as { MediaSource?: unknown }).MediaSource;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:fake');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});

afterEach(() => {
  stopTts();
  vi.restoreAllMocks();
});

describe('stripMarkdownForSpeech', () => {
  it('去除代码块/行内代码/链接/引用/标记符号', () => {
    expect(stripMarkdownForSpeech('**粗体** 和 `code`')).toBe('粗体 和 code');
    expect(stripMarkdownForSpeech('```js\nconst a = 1;\n```\n好了')).toBe('好了');
    expect(stripMarkdownForSpeech('[链接文字](https://x.com)')).toBe('链接文字');
    expect(stripMarkdownForSpeech('> 引用内容\n正文')).toBe('正文');
    expect(stripMarkdownForSpeech('# 标题\n- 列表项')).toBe('标题 列表项');
  });
});


describe('speakTts 一次性合成回退路径(无 MediaSource)', () => {
  it('合成成功后进入播放态,onended 后复位', async () => {
    mockedJarvisFetch.mockResolvedValueOnce(synthesizeOkResponse());
    await speakTts('你好', { messageId: 'm1' });
    expect(mockedJarvisFetch).toHaveBeenCalledWith(
      '/api/speech-generation/synthesize',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(getTtsState()).toEqual({ playing: true, messageId: 'm1', error: null });
    const el = FakeAudio.instances[0];
    expect(el.play).toHaveBeenCalled();
    el.onended?.();
    expect(getTtsState()).toEqual({ playing: false, messageId: null, error: null });
  });

  it('服务端错误透出为友好中文文案', async () => {
    mockedJarvisFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'text-to-speech model is not configured' }),
    } as unknown as Response);
    await speakTts('你好', { messageId: 'm2' });
    const s = getTtsState();
    expect(s.playing).toBe(false);
    expect(s.messageId).toBe('m2');
    expect(s.error).toContain('未配置语音模型');
  });

  it('play() 被 NotAllowedError 拒绝时提示自动播放受限', async () => {
    const err = new Error('play() failed');
    err.name = 'NotAllowedError';
    FakeAudio.rejectPlayWith = err;
    mockedJarvisFetch.mockResolvedValueOnce(synthesizeOkResponse());
    await speakTts('你好', { messageId: 'm3' });
    expect(getTtsState().error).toContain('自动播放');
  });
});

describe('speakTts 流式播放(MediaSource)', () => {
  beforeEach(() => {
    (globalThis as { MediaSource?: unknown }).MediaSource = FakeMediaSource;
  });

  it('SSE chunk 追加到 SourceBuffer,流结束强制开播并 endOfStream', async () => {
    const sse = 'event: chunk\ndata: {"data":"AAAA"}\n\nevent: end\ndata: {}\n\n';
    mockedJarvisFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: sseResponseBody(sse),
      json: async () => ({}),
    } as unknown as Response);
    await speakTts('短回复', { messageId: 's1' });
    expect(mockedJarvisFetch).toHaveBeenCalledWith(
      '/api/speech-generation/synthesize-stream',
      expect.objectContaining({ method: 'POST' }),
    );
    const ms = FakeMediaSource.instances[0];
    expect(ms.sourceBuffer.appended.length).toBe(1);
    expect(getTtsState()).toEqual({ playing: true, messageId: 's1', error: null });
    expect(ms.readyState).toBe('ended');
    FakeAudio.instances[0].onended?.();
    expect(getTtsState()).toEqual({ playing: false, messageId: null, error: null });
  });

  it('SSE error 事件 → 回退一次性合成', async () => {
    const sse = 'event: error\ndata: {"message":"upstream boom"}\n\n';
    mockedJarvisFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: sseResponseBody(sse),
        json: async () => ({}),
      } as unknown as Response)
      .mockResolvedValueOnce(synthesizeOkResponse());
    await speakTts('你好', { messageId: 's2' });
    expect(mockedJarvisFetch).toHaveBeenCalledTimes(2);
    expect(mockedJarvisFetch).toHaveBeenLastCalledWith(
      '/api/speech-generation/synthesize',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(getTtsState()).toEqual({ playing: true, messageId: 's2', error: null });
  });

  it('流式端点 HTTP 错误 → 回退一次性合成', async () => {
    mockedJarvisFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'stream unsupported' }),
      } as unknown as Response)
      .mockResolvedValueOnce(synthesizeOkResponse());
    await speakTts('你好', { messageId: 's3' });
    expect(mockedJarvisFetch).toHaveBeenCalledTimes(2);
    expect(getTtsState().playing).toBe(true);
  });
});
