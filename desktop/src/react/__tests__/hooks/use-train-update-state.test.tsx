/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTrainUpdateState } from '../../hooks/use-train-update-state';
import type { CrashFallbackNotice, PlatformApi, TrainUpdateAvailable, TrainUpdateProgress, TrainUpdateStatus } from '../../types';

let availableListener: ((payload: { version: string; minShellBlocked: boolean }) => void) | null = null;
let progressListener: ((progress: TrainUpdateProgress) => void) | null = null;
let fallbackListener: ((payload: CrashFallbackNotice) => void) | null = null;

function baseStatus(partial: Partial<TrainUpdateStatus> = {}): TrainUpdateStatus {
  return {
    staged: false,
    train: null,
    version: null,
    minShellBlocked: false,
    available: null,
    lastError: null,
    lastCheckedAt: null,
    currentVersion: '0.388.0',
    ...partial,
  };
}

function available(version: string): TrainUpdateAvailable {
  return {
    train: 9,
    version,
    serverSha256: 'a'.repeat(64),
    rendererSha256: 'b'.repeat(64),
    sizes: { server: 100, renderer: 200 },
    recordedAt: '2026-07-11T00:00:00.000Z',
  };
}

function installJarvis(overrides: Partial<PlatformApi> = {}) {
  availableListener = null;
  progressListener = null;
  fallbackListener = null;
  window.jarvis = {
    trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus()),
    trainUpdateCheck: vi.fn().mockResolvedValue({ outcome: 'up-to-date' }),
    trainUpdateApply: vi.fn().mockResolvedValue({ ok: true }),
    onTrainUpdateAvailable: vi.fn((cb) => {
      availableListener = cb;
      return () => { availableListener = null; };
    }),
    onTrainUpdateProgress: vi.fn((cb) => {
      progressListener = cb;
      return () => { progressListener = null; };
    }),
    onTrainFallbackNotice: vi.fn((cb) => {
      fallbackListener = cb;
      return () => { fallbackListener = null; };
    }),
    ackTrainFallbackNotice: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as PlatformApi;
}

function Harness() {
  const {
    currentVersion,
    available: availableUpdate,
    minShellBlocked,
    lastError,
    lastCheckedAt,
    manifestSource,
    manifestReleasedAt,
    originUnreachable,
    phase,
    progress,
    fallbackNotice,
    checkNow,
    applyNow,
    ackFallbackNotice,
  } = useTrainUpdateState();
  return (
    <div>
      <div data-testid="currentVersion">{currentVersion || 'none'}</div>
      <div data-testid="available">{availableUpdate?.version ?? 'none'}</div>
      <div data-testid="minShellBlocked">{String(minShellBlocked)}</div>
      <div data-testid="lastError">{lastError ?? 'none'}</div>
      <div data-testid="lastCheckedAt">{lastCheckedAt ?? 'none'}</div>
      <div data-testid="manifestSource">{manifestSource ?? 'none'}</div>
      <div data-testid="manifestReleasedAt">{manifestReleasedAt ?? 'none'}</div>
      <div data-testid="originUnreachable">{String(originUnreachable)}</div>
      <div data-testid="phase">{phase}</div>
      <div data-testid="progress">{progress ? `${progress.receivedBytes}/${progress.totalBytes}` : 'none'}</div>
      <div data-testid="fallbackNotice">{fallbackNotice ? `${fallbackNotice.kind}:${fallbackNotice.fromVersion}->${fallbackNotice.toVersion}` : 'none'}</div>
      <button onClick={() => void checkNow()}>check</button>
      <button onClick={() => void applyNow()}>apply</button>
      <button onClick={() => void ackFallbackNotice()}>ack-fallback</button>
    </div>
  );
}

describe('useTrainUpdateState', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    availableListener = null;
    progressListener = null;
  });

  it('hydrates currentVersion and a null available from the cached status on mount', async () => {
    installJarvis({ trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus({ currentVersion: '0.388.0' })) });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('currentVersion').textContent).toBe('0.388.0'));
    expect(screen.getByTestId('available').textContent).toBe('none');
    expect(screen.getByTestId('phase').textContent).toBe('idle');
  });

  it('surfaces a cached available update, lastError and lastCheckedAt verbatim (no staged/downloaded mapping)', async () => {
    installJarvis({
      trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus({
        currentVersion: '0.388.0',
        available: available('0.389.0'),
        lastError: 'network down',
        lastCheckedAt: '2026-07-11T08:00:00.000Z',
      })),
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('available').textContent).toBe('0.389.0'));
    expect(screen.getByTestId('lastError').textContent).toBe('network down');
    expect(screen.getByTestId('lastCheckedAt').textContent).toBe('2026-07-11T08:00:00.000Z');
  });

  it('hydrates manifestSource/manifestReleasedAt/originUnreachable from the cached status on mount, forwarded verbatim', async () => {
    installJarvis({
      trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus({
        manifestSource: 'mirror',
        manifestReleasedAt: '2026-07-11T00:00:00.000Z',
        originUnreachable: true,
      })),
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('manifestSource').textContent).toBe('mirror'));
    expect(screen.getByTestId('manifestReleasedAt').textContent).toBe('2026-07-11T00:00:00.000Z');
    expect(screen.getByTestId('originUnreachable').textContent).toBe('true');
  });

  it('defaults manifestSource/manifestReleasedAt to null and originUnreachable to false when the status omits them (pre-upgrade shell)', async () => {
    installJarvis({ trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus()) });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('currentVersion').textContent).toBe('0.388.0'));
    expect(screen.getByTestId('manifestSource').textContent).toBe('none');
    expect(screen.getByTestId('manifestReleasedAt').textContent).toBe('none');
    expect(screen.getByTestId('originUnreachable').textContent).toBe('false');
  });

  it('never reads the legacy staged/train/version fields — only `available` decides whether an update is showing', async () => {
    // staged=true with no `available` (the shape a shell that only understood
    // the old contract might still emit) must NOT surface as an update.
    installJarvis({
      trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus({ staged: true, train: 5, version: '0.400.0', available: null })),
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('currentVersion').textContent).toBe('0.388.0'));
    expect(screen.getByTestId('available').textContent).toBe('none');
  });

  it('lights up in real time when onTrainUpdateAvailable fires, without waiting for a remount', async () => {
    installJarvis();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('available').textContent).toBe('none'));

    act(() => {
      availableListener?.({ version: '0.390.0', minShellBlocked: false });
    });

    expect(screen.getByTestId('available').textContent).toBe('0.390.0');
    expect(screen.getByTestId('minShellBlocked').textContent).toBe('false');
  });

  it('checkNow goes checking -> idle and refreshes available/lastError/lastCheckedAt from a fresh read', async () => {
    let status = baseStatus({ currentVersion: '0.388.0' });
    installJarvis({
      trainUpdateStatus: vi.fn().mockImplementation(async () => status),
      trainUpdateCheck: vi.fn().mockImplementation(async () => {
        status = baseStatus({ currentVersion: '0.388.0', available: available('0.389.0'), lastCheckedAt: '2026-07-11T09:00:00.000Z' });
        return { outcome: 'available', train: 9, version: '0.389.0' };
      }),
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    await act(async () => {
      screen.getByText('check').click();
    });

    expect(screen.getByTestId('available').textContent).toBe('0.389.0');
    expect(screen.getByTestId('lastCheckedAt').textContent).toBe('2026-07-11T09:00:00.000Z');
    expect(screen.getByTestId('phase').textContent).toBe('idle');
  });

  it('checkNow surfaces an error outcome as lastError and returns phase to idle', async () => {
    installJarvis({
      trainUpdateCheck: vi.fn().mockResolvedValue({ outcome: 'error', error: 'network down' }),
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    await act(async () => {
      screen.getByText('check').click();
    });

    expect(screen.getByTestId('lastError').textContent).toBe('network down');
    expect(screen.getByTestId('phase').textContent).toBe('idle');
  });

  it('applyNow delegates straight to window.jarvis.trainUpdateApply and goes optimistically busy before the first progress event', async () => {
    const trainUpdateApply = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves in this test
    installJarvis({ trainUpdateApply });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    act(() => {
      screen.getByText('apply').click();
    });

    expect(trainUpdateApply).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('phase').textContent).toBe('downloading');
  });

  it('onTrainUpdateProgress drives phase (downloading vs applying) and byte progress while apply is in flight', async () => {
    installJarvis();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    act(() => {
      progressListener?.({ phase: 'downloading', kind: 'server', receivedBytes: 50, totalBytes: 200 });
    });
    expect(screen.getByTestId('phase').textContent).toBe('downloading');
    expect(screen.getByTestId('progress').textContent).toBe('50/200');

    // verifying stays in the "downloading" phase — the verify gap between
    // the two archives must not flash the bar to "applying" and back. This
    // event carries no overall fields (the shape an older shell that
    // hasn't picked up the overall-bytes fix would still send), so
    // progress falls back to the per-artifact receivedBytes/totalBytes.
    act(() => {
      progressListener?.({ phase: 'verifying', kind: 'server', receivedBytes: 200, totalBytes: 200 });
    });
    expect(screen.getByTestId('phase').textContent).toBe('downloading');
    expect(screen.getByTestId('progress').textContent).toBe('200/200');

    act(() => {
      progressListener?.({ phase: 'activating', kind: 'renderer', receivedBytes: 200, totalBytes: 200 });
    });
    expect(screen.getByTestId('phase').textContent).toBe('applying');
    expect(screen.getByTestId('progress').textContent).toBe('200/200');
  });

  it('onTrainUpdateProgress uses cumulative overall bytes across both artifacts so the bar never resets to 0 at the server/renderer boundary', async () => {
    installJarvis();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    // Server download in progress: overall tracks the server's own bytes
    // against the combined total (300 = 100 server + 200 renderer), not
    // the per-artifact total.
    act(() => {
      progressListener?.({
        phase: 'downloading', kind: 'server', receivedBytes: 50, totalBytes: 100,
        overallReceivedBytes: 50, overallTotalBytes: 300,
      });
    });
    expect(screen.getByTestId('phase').textContent).toBe('downloading');
    expect(screen.getByTestId('progress').textContent).toBe('50/300');

    // Server finishes, renderer download starts at 0 bytes of its own —
    // overallReceivedBytes must carry the server's full size forward
    // (100/300), not drop back toward 0 the way the old per-artifact
    // receivedBytes (0) would.
    act(() => {
      progressListener?.({
        phase: 'downloading', kind: 'renderer', receivedBytes: 0, totalBytes: 200,
        overallReceivedBytes: 100, overallTotalBytes: 300,
      });
    });
    expect(screen.getByTestId('phase').textContent).toBe('downloading');
    expect(screen.getByTestId('progress').textContent).toBe('100/300');

    // Renderer partway through: overall keeps climbing past the server's
    // own size, still one continuous sweep.
    act(() => {
      progressListener?.({
        phase: 'downloading', kind: 'renderer', receivedBytes: 80, totalBytes: 200,
        overallReceivedBytes: 180, overallTotalBytes: 300,
      });
    });
    expect(screen.getByTestId('progress').textContent).toBe('180/300');

    // Renderer activating: reaches the full combined total, and only
    // "activating" flips the phase to applying.
    act(() => {
      progressListener?.({
        phase: 'activating', kind: 'renderer', receivedBytes: 200, totalBytes: 200,
        overallReceivedBytes: 300, overallTotalBytes: 300,
      });
    });
    expect(screen.getByTestId('phase').textContent).toBe('applying');
    expect(screen.getByTestId('progress').textContent).toBe('300/300');
  });

  it('applyNow surfaces a failed apply as lastError and returns to idle so the user can retry', async () => {
    installJarvis({ trainUpdateApply: vi.fn().mockResolvedValue({ ok: false, error: 'sha256 mismatch' }) });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('idle'));

    await act(async () => {
      screen.getByText('apply').click();
    });

    expect(screen.getByTestId('lastError').textContent).toBe('sha256 mismatch');
    expect(screen.getByTestId('phase').textContent).toBe('idle');
  });

  it('hydrates fallbackNotice from the cached status on mount (cold-start pull path)', async () => {
    installJarvis({
      trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus({
        fallbackNotice: { kind: 'server', fromVersion: '0.390.0', toVersion: '0.389.0', quarantinedTrain: 7 },
      })),
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('fallbackNotice').textContent).toBe('server:0.390.0->0.389.0'));
  });

  it('lights up in real time when onTrainFallbackNotice fires, without waiting for a remount (renderer runtime crash path)', async () => {
    installJarvis();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('fallbackNotice').textContent).toBe('none'));

    act(() => {
      fallbackListener?.({ kind: 'renderer', fromVersion: '0.391.0', toVersion: '0.390.0', quarantinedTrain: 3 });
    });

    expect(screen.getByTestId('fallbackNotice').textContent).toBe('renderer:0.391.0->0.390.0');
  });

  it('ackFallbackNotice optimistically clears the notice and calls window.jarvis.ackTrainFallbackNotice', async () => {
    const ackTrainFallbackNotice = vi.fn().mockResolvedValue({ ok: true });
    installJarvis({
      trainUpdateStatus: vi.fn().mockResolvedValue(baseStatus({
        fallbackNotice: { kind: 'server', fromVersion: '0.390.0', toVersion: '0.389.0', quarantinedTrain: null },
      })),
      ackTrainFallbackNotice,
    });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('fallbackNotice').textContent).toBe('server:0.390.0->0.389.0'));

    await act(async () => {
      screen.getByText('ack-fallback').click();
    });

    expect(screen.getByTestId('fallbackNotice').textContent).toBe('none');
    expect(ackTrainFallbackNotice).toHaveBeenCalledTimes(1);
  });
});
