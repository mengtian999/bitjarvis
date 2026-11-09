/**
 * i18n-boot.ts — 主窗口首屏语言包预加载
 *
 * 背景（2026-11 首安装包启动诊断）：
 * 主窗口的 React 树在 initApp() 之前就已挂载，而 app-init 里的 i18n.load() 排在
 * 「server 端口就绪 → identity → health/config/agents」之后。server 冷启动慢的机器
 * （Windows Defender 逐文件扫描 server bundle，实测可达 60s+）上，主进程 30s 兜底
 * 显示窗口时语言包还没到，整屏只剩 `sidebar.bridgeShort` / `status.connecting`
 * 这类原始 key，看起来像卡死的坏页面。
 *
 * 这里在 render 之前就把语言包准备好，数据源完全不依赖 server：
 *   1. localStorage 缓存（上次启动成功加载的 locale，命中即零 IPC）
 *   2. 主进程 getSplashInfo()（读 agent config.yaml，splash 走的同一条路）
 *   3. navigator.language
 *
 * 纪律：加载失败 / 超时一律不阻塞启动——先渲染，等后台加载完成再由
 * store.locale 变化驱动整棵树重渲染（行为与改造前一致，只是窗口前 30s 不再是生 key）。
 */

import { useStore } from './stores';

/** localStorage 里缓存的语言偏好（下次启动命中即免 IPC）。 */
export const LOCALE_CACHE_KEY = 'jarvis-locale';

/**
 * 首屏等待语言包的上限。
 * 语言包是随包分发的本地文件（~180KB，file:// 下走 XHR），正常几十毫秒；
 * 超时就先渲染，绝不能因为一个 JSON 把窗口卡住。
 */
export const I18N_BOOT_TIMEOUT_MS = 1_200;

function readCachedLocale(): string | null {
  try {
    const value = window.localStorage?.getItem(LOCALE_CACHE_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function writeCachedLocale(locale: string): void {
  try {
    window.localStorage?.setItem(LOCALE_CACHE_KEY, locale);
  } catch {
    // 隐私模式 / 配额满：缓存只是加速，失败不影响启动
  }
}

async function readLocaleFromShell(): Promise<string | null> {
  try {
    const info = await window.jarvis?.getSplashInfo?.();
    const locale = info?.locale;
    return typeof locale === 'string' && locale.trim() ? locale.trim() : null;
  } catch {
    return null;
  }
}

/** 首屏可用的 locale：本地缓存 → 主进程读 config.yaml → 系统语言。 */
export async function resolveBootLocale(): Promise<string> {
  const cached = readCachedLocale();
  if (cached) return cached;
  const shellLocale = await readLocaleFromShell();
  if (shellLocale) return shellLocale;
  const systemLocale = typeof navigator !== 'undefined' ? navigator.language : '';
  return systemLocale || 'zh-CN';
}

/** 把已加载的语言同步进 store（locale 变化 → 整棵树重渲染）。 */
function syncStoreLocale(): string | null {
  const locale = window.i18n?.locale || null;
  if (locale) useStore.setState({ locale });
  return locale;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    promise.then(finish, () => finish(null));
  });
}

let bootPromise: Promise<string | null> | null = null;

/**
 * locale 代次：`syncLocale` 按服务端权威值重新加载时自增。
 * 首屏预加载的超时先渲染路径下，后台那次 load 可能晚于 syncLocale 落地——
 * 代次不一致就直接丢弃它的结果，免得「猜的」locale 覆盖服务端给的。
 */
let localeGeneration = 0;

/**
 * 首屏语言包预加载（幂等，多次调用共用同一次加载）。
 * resolve 值是本次实际可用的 locale；加载失败或超时为 null（调用方照常渲染）。
 */
export function bootstrapI18n(timeoutMs = I18N_BOOT_TIMEOUT_MS): Promise<string | null> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (!window.i18n || typeof window.i18n.load !== 'function') return null;
    const requested = await resolveBootLocale();
    const generation = localeGeneration;
    const loading = window.i18n.load(requested).then(() => {
      if (generation !== localeGeneration) return null;
      syncStoreLocale();
      // 缓存的是「用户想要的语言」（下次启动直接沿用它去加载）；返回值是
      // 实际落地的语言包 key，没加载到就是 null，调用方按"没准备好"处理。
      const loaded = window.i18n.loadedLocale || null;
      if (loaded) writeCachedLocale(requested);
      return loaded;
    });
    return withTimeout(loading, timeoutMs);
  })();
  return bootPromise;
}

/**
 * 用服务端返回的 locale 对齐语言包。
 *
 * 服务端是语言偏好的最终权威（用户可能在设置里改过、也可能是另一个客户端改的），
 * 首屏预加载只是一次「猜测」。这里判重：目标语言已经加载过就只同步 store，
 * 不再重复拉一次语言包；不同则重新加载并由 store.locale 驱动重渲染。
 */
export async function syncLocale(locale: string | null | undefined): Promise<void> {
  const target = locale && locale.trim() ? locale.trim() : 'zh-CN';
  const i18n = window.i18n;
  if (!i18n || typeof i18n.load !== 'function') return;

  const targetKey = typeof i18n.resolveLocaleKey === 'function'
    ? i18n.resolveLocaleKey(target)
    : target;
  if (i18n.loadedLocale === targetKey) {
    syncStoreLocale();
    return;
  }

  localeGeneration += 1;
  await i18n.load(target);
  // 只有真的加载到语言包才更新缓存，避免把一次失败的请求固化成下次的偏好。
  if (i18n.loadedLocale) writeCachedLocale(target);
  syncStoreLocale();
}