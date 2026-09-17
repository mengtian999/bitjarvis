// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { switchTab } from '../../components/channels/ChannelTabBar';
import { useStore } from '../../stores';

describe('ChannelTabBar switchTab', () => {
  let localStorageData: Record<string, string>;

  beforeEach(() => {
    localStorageData = {};
    const storage = {
      getItem: vi.fn((key: string) => localStorageData[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageData[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageData[key];
      }),
      clear: vi.fn(() => {
        localStorageData = {};
      }),
    };
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
    });
    useStore.setState({
      currentTab: 'chat',
      sidebarOpen: true,
      sidebarAutoCollapsed: false,
      jianOpen: true,
      jianAutoCollapsed: false,
      activePanel: null,
    } as never);
  });

  it('keeps the right workspace companion state independent from tab switches', () => {
    localStorage.setItem('jarvis-jian-plugin:jarvis-hyperframes', 'closed');
    localStorage.setItem('jarvis-jian-plugin:other-plugin', 'open');

    switchTab('plugin:jarvis-hyperframes');

    expect(useStore.getState().currentTab).toBe('plugin:jarvis-hyperframes');
    expect(useStore.getState().jianOpen).toBe(true);

    switchTab('plugin:other-plugin');

    expect(useStore.getState().currentTab).toBe('plugin:other-plugin');
    expect(useStore.getState().jianOpen).toBe(true);
  });
});
