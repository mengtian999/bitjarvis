/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoUpdateStatus } from '../../components/AutoUpdateStatus';
import type { AutoUpdateState } from '../../types';

const labels: Record<string, string> = {
  'settings.about.updateDownloading': '{agentName}正在准备新家',
  'settings.about.updateProgress': '{percent}%',
  'settings.about.updateReadyInstall': 'v{version} 已就绪',
  'settings.about.updateInstall': '重启更新',
  'settings.about.updateInstallManualHint': '点重启更新后安装，直接退出不会自动安装',
  'settings.about.updateApply': '更新',
  'settings.about.updateApplyAutoHint': '不点击也会在下次启动时自动生效',
  'settings.about.updateInstalling': '正在安装更新，Bit Jarvis 会自动重启…',
  'settings.about.updateNeedInstall': '请先将 Bit Jarvis 移动到应用程序文件夹',
  'settings.about.updateDigestCta': '此次更新你将获得',
  'settings.about.updateDigestTitle': '此次更新你将获得',
  'settings.about.updateDigestClose': '关闭',
  'settings.about.updateDigestKind.feature': '新功能',
  'settings.about.updateDigestKind.fix': '修复',
  'settings.about.updateDigestKind.improvement': '改进',
  'settings.about.updateDigestKind.migration': '迁移',
};

function translate(key: string, vars?: Record<string, string | number>): string {
  let value = labels[key] ?? key;
  for (const [name, replacement] of Object.entries(vars ?? {})) {
    value = value.replace(`{${name}}`, String(replacement));
  }
  return value;
}

function updateState(partial: Partial<AutoUpdateState>): AutoUpdateState {
  return {
    status: 'idle',
    version: null,
    releaseNotes: null,
    releaseUrl: null,
    downloadUrl: null,
    progress: null,
    error: null,
    ...partial,
  };
}

describe('AutoUpdateStatus', () => {
  beforeEach(() => {
    window.t = translate as typeof window.t;
    document.documentElement.lang = 'zh';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders real-time download progress with bounded percent', () => {
    render(
      <AutoUpdateStatus
        state={updateState({
          status: 'downloading',
          progress: { percent: 42.6, bytesPerSecond: 0, transferred: 0, total: 0 },
        })}
        agentName="小花"
        variant="shell"
      />,
    );

    expect(screen.getByText('小花正在准备新家')).toBeTruthy();
    expect(screen.getAllByText('43%')).toHaveLength(1);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('43');
  });

  it('keeps the restart action in-page after the update is downloaded', () => {
    const onInstall = vi.fn();

    render(
      <AutoUpdateStatus
        state={updateState({ status: 'downloaded', version: '0.118.0' })}
        onInstall={onInstall}
        variant="shell"
      />,
    );

    expect(screen.getByText('v0.118.0 已就绪')).toBeTruthy();
    expect(screen.getByText('点重启更新后安装，直接退出不会自动安装')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /重启更新/ }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('shows the apply-now label and no-restart hint for the train variant', () => {
    const onInstall = vi.fn();

    render(
      <AutoUpdateStatus
        state={updateState({ status: 'downloaded', version: '0.500.0' })}
        onInstall={onInstall}
        variant="train"
      />,
    );

    expect(screen.getByText('v0.500.0 已就绪')).toBeTruthy();
    expect(screen.getByText('不点击也会在下次启动时自动生效')).toBeTruthy();
    expect(screen.queryByText('点重启更新后安装，直接退出不会自动安装')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /更新/ }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('opens a bilingual release digest from the update status block', () => {
    render(
      <AutoUpdateStatus
        state={updateState({
          status: 'downloaded',
          version: '0.425.4',
          digest: {
            schemaVersion: 1,
            tag: 'v0.425.4',
            version: '0.425.4',
            previousTag: 'v0.425.3',
            generatedAt: '2026-07-05T00:00:00.000Z',
            noUserFacingChanges: false,
            summary: { zh: '更新说明变得更清楚。', en: 'Update notes are clearer.' },
            counts: { feature: 1, fix: 0, improvement: 0, migration: 0 },
            items: [
              {
                id: 'digest',
                kind: 'feature',
                importance: 'high',
                title: { zh: '更新摘要', en: 'Update digest' },
                summary: { zh: 'About 页能看到本次更新内容。', en: 'The About page shows this update.' },
                details: [{ zh: '摘要跟随 release 资产分发。', en: 'The digest ships as a release asset.' }],
                sources: [],
              },
            ],
          },
        })}
        variant="shell"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '此次更新你将获得' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('更新说明变得更清楚。')).toBeTruthy();
    expect(screen.getByText('更新摘要')).toBeTruthy();
    expect(screen.getByText('摘要跟随 release 资产分发。')).toBeTruthy();
  });

  it('renders installing and dmg install guidance without a modal contract', () => {
    const { rerender } = render(
      <AutoUpdateStatus state={updateState({ status: 'installing' })} variant="shell" />,
    );

    expect(screen.getByText('正在安装更新，Bit Jarvis 会自动重启…')).toBeTruthy();

    rerender(<AutoUpdateStatus state={updateState({ status: 'error', error: 'running_from_dmg' })} variant="shell" />);
    expect(screen.getByText('请先将 Bit Jarvis 移动到应用程序文件夹')).toBeTruthy();
  });
});
