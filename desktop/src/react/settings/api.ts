/**
 * Settings window API utilities
 * 从 settings store 读 port/token，独立于主窗口
 */
import { useSettingsStore } from './store';
import {
  appendConnectionAuth,
  buildConnectionUrl,
  requireServerConnection,
} from '../services/server-connection';

const DEFAULT_TIMEOUT = 30_000;

export function jarvisUrl(path: string): string {
  const connection = requireServerConnection(
    useSettingsStore.getState(),
    `settings jarvisUrl ${path}: server connection not ready`,
  );
  return buildConnectionUrl(connection, path, { includeTokenQuery: true });
}

export async function jarvisFetch(
  path: string,
  opts: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const connection = requireServerConnection(
    useSettingsStore.getState(),
    `settings jarvisFetch ${path}: server connection not ready`,
  );
  const headers = appendConnectionAuth(connection, opts.headers);

  const { timeout = DEFAULT_TIMEOUT, signal: callerSignal, ...fetchOpts } = opts;
  const controller = new AbortController();
  // 超时 abort 必须带 reason，否则 fetch 会 reject 为
  // `AbortError: signal is aborted without reason`，调用方无法区分是超时还是主动取消。
  const timeoutError = () =>
    new DOMException(`jarvisFetch ${path} timed out after ${timeout}ms`, 'TimeoutError');
  const timer = setTimeout(() => controller.abort(timeoutError()), timeout);

  // If caller provided a signal, forward its abort to our controller
  if (callerSignal) {
    if (callerSignal.aborted) { controller.abort((callerSignal as any).reason); }
    else { callerSignal.addEventListener('abort', () => controller.abort((callerSignal as any).reason), { once: true }); }
  }

  try {
    const res = await fetch(buildConnectionUrl(connection, path), {
      ...fetchOpts,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await readErrorMessage(res);
      throw new Error(detail || `jarvisFetch ${path}: ${res.status} ${res.statusText}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 是否为 jarvisFetch 的超时错误。
 * 超时 abort 带了 TimeoutError reason，fetch 会直接以该 reason reject；
 * 旧版本无 reason 时表现为 `AbortError: signal is aborted without reason`，
 * 这里一并识别，避免调用方把超时显示成无意义的英文。
 */
export function isJarvisFetchTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  if (name === 'TimeoutError') return true;
  if (name === 'AbortError') {
    const message = (err as { message?: string }).message || '';
    return message.includes('timed out after') || message.includes('without reason');
  }
  return false;
}

async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      const data = JSON.parse(text);
      if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
      if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
    } catch {
      return text.trim() || null;
    }
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** 根据 yuan 类型返回 fallback 头像路径 */
export function yuanFallbackAvatar(yuan?: string): string {
  const t = window.t || ((k: string) => k);
  const types = (t('yuan.types') || {}) as Record<string, { avatar?: string }>;
  const entry = types[yuan || 'jarvis'];
  return `assets/${entry?.avatar || 'Jarvis.png'}`;
}
