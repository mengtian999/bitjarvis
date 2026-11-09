/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * i18n-boot 的职责：在 React 挂载之前把语言包准备好，并且绝不阻塞启动。
 * 这里的断言围绕三件事：
 * 1. locale 来源优先级（localStorage 缓存 → 主进程 config.yaml → 系统语言）
 * 2. 加载成功后同步 store / 写缓存（下一次启动免 IPC）
 * 3. 加载失败或超时必须 resolve（不能把首屏卡住）
 */

const mockSetState = vi.fn();

vi.mock('../stores', () => ({
  useStore: {
    setState: (patch: unknown) => mockSetState(patch),
  },
}));

type LoadSpy = ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<void>>>;

function installI18n(options: {
  locale?: string;
  loadedLocale?: string | null;
  load?: LoadSpy;
  resolveLocaleKey?: (locale: string) => string;
} = {}) {
  const i18n = {
    locale: options.locale ?? 'zh',
    defaultName: 'Jarvis',
    loadedLocale: options.loadedLocale ?? null,
    _data: {},
    _agentOverrides: {},
    load: options.load ?? vi.fn(async () => {}),
    resolveLocaleKey: options.resolveLocaleKey ?? ((locale: string) => (locale.startsWith('zh') ? 'zh' : 'en')),
    setAgentOverrides: vi.fn(),
    t: (path: string) => path,
  };
  (globalThis as Record<string, unknown>).i18n = i18n;
  return i18n;
}

function installJarvis(getSplashInfo?: () => Promise<{ locale?: string } | null>) {
  (globalThis as Record<string, unknown>).jarvis = getSplashInfo ? { getSplashInfo } : {};
}

async function importBoot() {
  vi.resetModules();
  return import('../i18n-boot');
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
  } as Storage;
}

describe('i18n-boot', () => {
  let storage: Storage;

  beforeEach(() => {
    mockSetState.mockClear();
    // jsdom 下 localStorage 依赖 window.url；Node 24 还会先暴露一个实验性的空实现，
    // 这里显式装一份内存实现，测试不依赖宿主环境细节。
    storage = createMemoryStorage();
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'i18n');
    Reflect.deleteProperty(globalThis, 'jarvis');
    vi.restoreAllMocks();
  });

  it('prefers the cached locale and skips the main-process round trip', async () => {
    storage.setItem('jarvis-locale', 'ja');
    const getSplashInfo = vi.fn(async () => ({ locale: 'en' }));
    installJarvis(getSplashInfo);

    const { resolveBootLocale, LOCALE_CACHE_KEY } = await importBoot();

    expect(LOCALE_CACHE_KEY).toBe('jarvis-locale');
    await expect(resolveBootLocale()).resolves.toBe('ja');
    expect(getSplashInfo).not.toHaveBeenCalled();
  });

  it('falls back to the shell config locale, then to navigator.language', async () => {
    installJarvis(async () => ({ locale: 'zh-TW' }));
    let boot = await importBoot();
    await expect(boot.resolveBootLocale()).resolves.toBe('zh-TW');

    installJarvis(async () => null);
    boot = await importBoot();
    await expect(boot.resolveBootLocale()).resolves.toBe(navigator.language || 'zh-CN');
  });

  it('loads the locale, syncs the store and caches the requested locale', async () => {
    installJarvis(async () => ({ locale: 'zh-CN' }));
    const i18n = installI18n({
      load: vi.fn(async () => {
        i18n.locale = 'zh';
        i18n.loadedLocale = 'zh';
      }),
    });

    const { bootstrapI18n } = await importBoot();
    const first = await bootstrapI18n();
    const second = await bootstrapI18n();

    expect(i18n.load).toHaveBeenCalledTimes(1);
    expect(i18n.load).toHaveBeenCalledWith('zh-CN');
    expect(first).toBe('zh');
    expect(second).toBe('zh');
    expect(mockSetState).toHaveBeenCalledWith({ locale: 'zh' });
    expect(storage.getItem('jarvis-locale')).toBe('zh-CN');
  });

  it('resolves null instead of hanging when the locale never finishes loading', async () => {
    installJarvis(async () => ({ locale: 'zh-CN' }));
    installI18n({ load: vi.fn(() => new Promise<void>(() => {})) });

    const { bootstrapI18n } = await importBoot();
    await expect(bootstrapI18n(20)).resolves.toBeNull();
  });

  it('does not throw when the i18n runtime is missing', async () => {
    installJarvis(async () => ({ locale: 'zh-CN' }));

    const { bootstrapI18n, syncLocale } = await importBoot();
    await expect(bootstrapI18n()).resolves.toBeNull();
    await expect(syncLocale('en')).resolves.toBeUndefined();
  });

  it('skips reloading the same locale bundle but reloads on a real locale change', async () => {
    const load = vi.fn(async () => {});
    const i18n = installI18n({ locale: 'zh', loadedLocale: 'zh', load });

    const { syncLocale } = await importBoot();

    await syncLocale('zh-CN');
    expect(load).not.toHaveBeenCalled();
    expect(mockSetState).toHaveBeenCalledWith({ locale: 'zh' });

    await syncLocale('en-US');
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('en-US');
    expect(i18n.load).toHaveBeenCalledTimes(1);
  });

  it('drops a late first-paint load instead of overriding the server locale', async () => {
    installJarvis(async () => ({ locale: 'zh-CN' }));

    let resolveFirstLoad!: () => void;
    const firstLoad = new Promise<void>((resolve) => { resolveFirstLoad = resolve; });
    const load = vi.fn()
      // 首屏预加载：故意挂住，触发 bootstrapI18n 的超时先渲染
      .mockImplementationOnce(() => firstLoad)
      // 服务端对齐：立刻落地 en
      .mockImplementationOnce(async () => {
        window.i18n.locale = 'en';
        window.i18n.loadedLocale = 'en';
      });
    installI18n({ locale: 'zh', loadedLocale: null, load });

    const { bootstrapI18n, syncLocale } = await importBoot();

    await expect(bootstrapI18n(5)).resolves.toBeNull();
    await syncLocale('en-US');
    expect(mockSetState).toHaveBeenLastCalledWith({ locale: 'en' });

    // 首屏那次慢加载此刻才回来（会把 locale 改回 zh），必须被代次检查丢弃
    mockSetState.mockClear();
    window.i18n.locale = 'zh';
    resolveFirstLoad();
    await firstLoad;
    await Promise.resolve();

    expect(mockSetState).not.toHaveBeenCalled();
    expect(storage.getItem('jarvis-locale')).toBe('en-US');
  });
});