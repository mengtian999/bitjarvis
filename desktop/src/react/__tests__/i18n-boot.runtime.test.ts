/**
 * @vitest-environment jsdom
 *
 * 这条用例跑的是**真实**的 desktop/src/lib/i18n.js（不是 stub），验证首屏预加载
 * 这条链路本身：i18n-boot 依赖的 loadedLocale / resolveLocaleKey 确实存在，
 * 且 bootstrapI18n 之后再 t() 拿到的是语言包文案而不是原始 key。
 * 这正是首安装包慢启动时「满屏 sidebar.bridgeShort」缺的那一环。
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const zhBundlePath = path.join(process.cwd(), 'desktop/src/locales/zh.json');

afterEach(() => {
  Reflect.deleteProperty(window, 'i18n');
  Reflect.deleteProperty(window, 't');
  Reflect.deleteProperty(window, 'jarvis');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('i18n-boot with the shipped i18n runtime', () => {
  it('loads the real locale bundle before first paint resolves', async () => {
    const zh = JSON.parse(fs.readFileSync(zhBundlePath, 'utf8'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(zh), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    (globalThis as Record<string, unknown>).jarvis = {
      getSplashInfo: vi.fn(async () => ({ locale: 'zh-CN' })),
    };

    // @ts-expect-error i18n.js is a browser side-effect script without module declarations.
    await import('../../lib/i18n.js');
    expect(window.i18n.loadedLocale).toBeNull();
    expect(typeof window.i18n.resolveLocaleKey).toBe('function');
    expect(window.i18n.resolveLocaleKey?.('zh-CN')).toBe('zh');

    const { bootstrapI18n } = await import('../i18n-boot');
    await expect(bootstrapI18n()).resolves.toBe('zh');

    expect(window.t('sidebar.bridgeShort')).not.toBe('sidebar.bridgeShort');
    expect(window.t('status.connecting')).not.toBe('status.connecting');
  });

  it('keeps the original key as fallback when no bundle is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.stubGlobal('XMLHttpRequest', undefined);
    (globalThis as Record<string, unknown>).jarvis = {};

    // @ts-expect-error i18n.js is a browser side-effect script without module declarations.
    await import('../../lib/i18n.js');
    const { bootstrapI18n } = await import('../i18n-boot');

    await expect(bootstrapI18n()).resolves.toBeNull();
    expect(window.t('sidebar.bridgeShort')).toBe('sidebar.bridgeShort');
  });
});