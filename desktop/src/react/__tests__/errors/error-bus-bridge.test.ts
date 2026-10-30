// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorBus } from '../../../../../shared/error-bus.ts';
import { AppError } from '../../../../../shared/errors.ts';
import { initErrorBusBridge } from '../../errors/error-bus-bridge';
import { useStore } from '../../stores';
import { installWindowTestT } from '../helpers/i18n-test-strings';

describe('error-bus-bridge', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    errorBus._listeners = [];
    errorBus._recentFingerprints = new Map();
    useStore.setState({ addToast } as never);
    initErrorBusBridge();
  });

  it('shows the localized copy instead of the English message the error carries', () => {
    installWindowTestT({ 'error.llmAuthFailed': '模型凭证无效' });

    errorBus.report(new AppError('LLM_AUTH_FAILED', { message: 'invalid api key' }));

    expect(addToast).toHaveBeenCalledWith(
      '模型凭证无效',
      'error',
      5000,
      expect.objectContaining({ errorCode: 'LLM_AUTH_FAILED' }),
    );
  });

  it('falls back to the raw message when the locale file has no entry for the key', () => {
    installWindowTestT({});

    errorBus.report(new AppError('LLM_AUTH_FAILED', { message: 'invalid api key' }));

    expect(addToast).toHaveBeenCalledWith(
      'invalid api key',
      'error',
      5000,
      expect.objectContaining({ errorCode: 'LLM_AUTH_FAILED' }),
    );
  });

  it('falls back to the code when neither a translation nor a message exists', () => {
    installWindowTestT({});

    errorBus.report(new AppError('LLM_AUTH_FAILED', { message: '' }));

    expect(addToast).toHaveBeenCalledWith(
      'LLM_AUTH_FAILED',
      'error',
      5000,
      expect.objectContaining({ errorCode: 'LLM_AUTH_FAILED' }),
    );
  });

  it('不弹 toast：已由会话内 inline 提示接管的可恢复 LLM 错误', () => {
    for (const code of ['LLM_TIMEOUT', 'LLM_RATE_LIMITED', 'LLM_EMPTY_RESPONSE', 'turn_interrupted']) {
      errorBus.report(new AppError(code, { message: `${code} raw message` }));
      // turn_interrupted 不在 ERROR_DEFS 里，未知码按 UNKNOWN 处理，仍是 degraded。
      expect(addToast).not.toHaveBeenCalled();
    }
  });

  it('不弹 toast：连接状态与噪音级错误由 statusbar / 日志接管', () => {
    errorBus.report(new AppError('WS_DISCONNECTED'));
    errorBus.report(new AppError('LLM_SLOW_RESPONSE', { context: { model: 'm' } }));

    expect(addToast).not.toHaveBeenCalled();
  });

  it('同码错误在抑制窗口内只提醒一次', () => {
    errorBus.report(new AppError('LLM_AUTH_FAILED', { message: 'invalid api key' }));
    errorBus.report(new AppError('LLM_AUTH_FAILED', { message: 'invalid api key' }));
    errorBus.report(new AppError('LLM_AUTH_FAILED', { message: 'invalid api key' }));

    expect(addToast).toHaveBeenCalledTimes(1);
  });
});
