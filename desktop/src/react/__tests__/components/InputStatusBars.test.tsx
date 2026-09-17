// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputStatusBars } from '../../components/input/InputStatusBars';
import { installWindowTestT } from '../helpers/i18n-test-strings';

describe('InputStatusBars', () => {
  it('shows an indeterminate screenshot progress bar above the chat input', () => {
    render(
      <InputStatusBars
        slashBusy={null}
        slashBusyLabel="执行中..."
        compacting={false}
        compactingLabel="上下文压缩中"
        screenshotBusy
        screenshotLabel="正在截图"
        screenshotPageLabel="正在截图，第 2/4 页"
        screenshotProgress={{
          completedBlocks: 12,
          totalBlocks: 37,
          currentPage: 2,
          totalPages: 4,
        }}
        inlineError={null}
        slashResult={null}
        onResultClick={undefined}
      />,
    );

    expect(screen.getByText('正在截图，第 2/4 页')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: '正在截图，第 2/4 页' });
    expect(progress).toHaveAttribute('aria-valuenow', '12');
    expect(progress).toHaveAttribute('aria-valuemax', '37');
  });
});

const QUIET_PROPS = {
  slashBusy: null,
  slashBusyLabel: '',
  compacting: false,
  compactingLabel: '',
  screenshotBusy: false,
  screenshotLabel: '',
  slashResult: null,
  onResultClick: undefined,
};

describe('InputStatusBars · inline error', () => {
  beforeEach(() => {
    installWindowTestT({
      'error.detailShow': '详情',
      'error.detailHide': '收起',
      'error.dismiss': '关闭',
    });
  });

  afterEach(cleanup);

  it('shows the human sentence and hides the technical detail until asked', () => {
    render(<InputStatusBars
      {...QUIET_PROPS}
      inlineError={{
        text: '这条消息之后还有任务在跑，等它结束再从这里分支',
        detail: 'active task cannot be shared by a session fork: subagent-1785635522479-v82otz',
        code: 'session_fork_active_task',
      }}
    />);

    expect(screen.getByText('这条消息之后还有任务在跑，等它结束再从这里分支')).toBeInTheDocument();
    expect(screen.queryByText(/subagent-1785635522479/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '详情' }));

    expect(screen.getByText(/subagent-1785635522479/)).toBeInTheDocument();
    expect(screen.getByText('session_fork_active_task')).toBeInTheDocument();
  });

  it('collapses again on a second click', () => {
    render(<InputStatusBars
      {...QUIET_PROPS}
      inlineError={{ text: '出了点意外', detail: "version `GLIBC_2.29' not found", code: null }}
    />);

    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.getByText(/GLIBC_2.29/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByText(/GLIBC_2.29/)).not.toBeInTheDocument();
  });

  it('offers no toggle when the error carries nothing extra to show', () => {
    render(<InputStatusBars
      {...QUIET_PROPS}
      inlineError={{ text: '会话正忙，稍后再试', detail: null, code: null }}
    />);

    expect(screen.getByText('会话正忙，稍后再试')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '详情' })).not.toBeInTheDocument();
  });

  it('re-collapses when a different error replaces the current one', () => {
    const { rerender } = render(<InputStatusBars
      {...QUIET_PROPS}
      inlineError={{ text: '第一个错误', detail: 'first detail', code: null }}
    />);

    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.getByText('first detail')).toBeInTheDocument();

    rerender(<InputStatusBars
      {...QUIET_PROPS}
      inlineError={{ text: '第二个错误', detail: 'second detail', code: null }}
    />);

    expect(screen.queryByText('second detail')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();
  });

  it('offers a dismiss button only when a dismiss handler is provided', () => {
    const onDismissError = vi.fn();
    const { rerender } = render(<InputStatusBars
      {...QUIET_PROPS}
      inlineError={{ text: '出错了', detail: null, code: null }}
      onDismissError={onDismissError}
    />);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onDismissError).toHaveBeenCalledTimes(1);

    rerender(<InputStatusBars
      {...QUIET_PROPS}
      inlineError={{ text: '出错了', detail: null, code: null }}
    />);
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
  });
});

describe('InputStatusBars · 中断提示（turn_interrupted）', () => {
  beforeEach(() => {
    installWindowTestT({
      'error.retryTurn': '重试',
      'error.continueTask': '继续任务',
      'error.dismiss': '关闭',
    });
  });

  afterEach(cleanup);

  const INTERRUPTED = {
    text: '任务已中断：助手本轮没有完成，可以重试或让它继续。',
    detail: 'turn_stall_timeout',
    code: 'turn_interrupted',
  };

  it('renders retry / continue / dismiss actions for an interrupted turn', () => {
    const onRetryTurn = vi.fn();
    const onContinueTask = vi.fn();
    const onDismissError = vi.fn();
    render(<InputStatusBars
      {...QUIET_PROPS}
      inlineError={INTERRUPTED}
      onDismissError={onDismissError}
      onRetryTurn={onRetryTurn}
      onContinueTask={onContinueTask}
    />);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    fireEvent.click(screen.getByRole('button', { name: '继续任务' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    expect(onRetryTurn).toHaveBeenCalledTimes(1);
    expect(onContinueTask).toHaveBeenCalledTimes(1);
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it('hides the turn actions for other error codes', () => {
    render(<InputStatusBars
      {...QUIET_PROPS}
      inlineError={{ text: '出了点意外', detail: 'boom', code: 'LLM_TIMEOUT' }}
      onDismissError={() => {}}
      onRetryTurn={() => {}}
      onContinueTask={() => {}}
    />);

    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '继续任务' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });
});
