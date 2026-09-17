// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelTabBar } from '../../components/channels/ChannelTabBar';
import { jarvisFetch } from '../../hooks/use-jarvis-fetch';
import { useStore } from '../../stores';

vi.mock('../../hooks/use-jarvis-fetch', () => ({
  jarvisFetch: vi.fn(),
}));

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ChannelTabBar overflow', () => {
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
    vi.stubGlobal('t', (key: string) => key);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
    });
    window.t = ((key: string) => key) as typeof window.t;
    vi.mocked(jarvisFetch).mockReset();
    vi.mocked(jarvisFetch).mockImplementation(async () => jsonResponse({ ok: true }));
    useStore.setState({
      currentTab: 'chat',
      sidebarOpen: true,
      sidebarAutoCollapsed: false,
      activePanel: null,
      locale: 'zh-CN',
      pluginPages: [
        {
          pluginId: 'hidden-notes',
          title: 'Hidden Notes',
          icon: null,
          routeUrl: '/api/plugins/hidden-notes/page',
          hostCapabilities: [],
        },
      ],
      hiddenPluginTabs: ['hidden-notes'],
      tabOrder: [],
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the hidden plugin tab menu outside the titlebar and opens the selected page', () => {
    const { container } = render(
      <div className="titlebar">
        <ChannelTabBar />
      </div>,
    );
    const titlebar = container.querySelector('.titlebar');
    expect(titlebar).not.toBeNull();

    fireEvent.click(screen.getByTitle('channel.moreTabs'));
    const hiddenTabButton = screen.getByRole('button', { name: 'Hidden Notes' });

    expect(titlebar).not.toContainElement(hiddenTabButton);

    fireEvent.click(hiddenTabButton);

    expect(useStore.getState().hiddenPluginTabs).toEqual([]);
    expect(useStore.getState().currentTab).toBe('plugin:hidden-notes');
    expect(localStorage.getItem('jarvis-tab')).toBe('plugin:hidden-notes');
  });
});
