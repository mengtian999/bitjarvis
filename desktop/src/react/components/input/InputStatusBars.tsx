import { memo, useEffect, useState } from 'react';
import styles from './InputArea.module.css';
import type { InlineErrorEntry } from '../../stores/streaming-slice';
import { TURN_INTERRUPTED_ERROR_CODE } from '../../stores/streaming-slice';

interface Props {
  slashBusy: string | null;
  slashBusyLabel: string;
  compacting: boolean;
  compactingLabel: string;
  screenshotBusy: boolean;
  screenshotLabel: string;
  screenshotPageLabel?: string | null;
  screenshotProgress?: {
    completedBlocks: number;
    totalBlocks: number;
    currentPage: number;
    totalPages: number;
  } | null;
  inlineError: InlineErrorEntry | null;
  modelUnavailableMessage?: string | null;
  slashResult: { text: string; type: 'success' | 'error'; deskDir?: string; filePath?: string } | null;
  onResultClick: (() => void) | undefined;
  /** 手动关闭错误条（持久错误不再靠 TTL 自动消失，必须给用户出路）。 */
  onDismissError?: () => void;
  /** 仅 code === turn_interrupted 时出现：重发上一条用户消息。 */
  onRetryTurn?: () => void;
  /** 仅 code === turn_interrupted 时出现：让助手接着未完成的任务继续。 */
  onContinueTask?: () => void;
  turnActionBusy?: boolean;
}

/** 输入区域上方的状态提示条（slash 执行中 / 压缩中 / 错误 / 结果） */
export const InputStatusBars = memo(function InputStatusBars({
  slashBusy, slashBusyLabel, compacting, compactingLabel,
  screenshotBusy, screenshotLabel, screenshotPageLabel, screenshotProgress,
  inlineError, modelUnavailableMessage = null, slashResult, onResultClick,
  onDismissError, onRetryTurn, onContinueTask, turnActionBusy = false,
}: Props) {
  const completedBlocks = screenshotProgress?.completedBlocks ?? 0;
  const totalBlocks = screenshotProgress?.totalBlocks ?? 0;
  const percent = totalBlocks > 0
    ? Math.min(100, Math.max(0, (completedBlocks / totalBlocks) * 100))
    : 0;
  const progressLabel = screenshotPageLabel || screenshotLabel;
  const resultClickable = !!onResultClick;
  const t = window.t ?? ((key: string) => key);
  // 详情默认收起；换了一条错误就重新收起，免得旧错误的展开态套在新错误上。
  const [errorExpanded, setErrorExpanded] = useState(false);
  useEffect(() => { setErrorExpanded(false); }, [inlineError]);
  const errorHasDetail = !!(inlineError?.detail || inlineError?.code);

  return (
    <>
      {slashBusy && (
        <div className={styles['slash-busy-bar']}>
          <span className={styles['slash-busy-dot']} />
          <span>{slashBusyLabel}</span>
        </div>
      )}
      {compacting && (
        <div className={styles['slash-busy-bar']}>
          <span className={styles['slash-busy-dot']} />
          <span>{compactingLabel}</span>
        </div>
      )}
      {screenshotBusy && (
        <div className={`${styles['slash-busy-bar']} ${styles['screenshot-busy-bar']}`}>
          <div className={styles['screenshot-busy-label']}>
            <span className={styles['slash-busy-dot']} />
            <span>{progressLabel}</span>
          </div>
          <div
            className={styles['screenshot-progress-track']}
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={0}
            aria-valuemax={totalBlocks || 1}
            aria-valuenow={Math.min(completedBlocks, totalBlocks || completedBlocks)}
          >
            <span
              className={styles['screenshot-progress-fill']}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
      {inlineError && (
        <div className={`${styles['slash-error-bar']} ${styles['slash-error-bar-stacked']}`}>
          <div className={styles['slash-error-headline']}>
            <span className={styles['slash-error-dot']} />
            <span className={styles['slash-error-text']}>{inlineError.text}</span>
            {errorHasDetail && (
              <button
                type="button"
                className={styles['slash-error-toggle']}
                onClick={() => setErrorExpanded((open) => !open)}
                aria-expanded={errorExpanded}
              >
                {errorExpanded ? t('error.detailHide') : t('error.detailShow')}
              </button>
            )}
          </div>
          {errorHasDetail && errorExpanded && (
            <div className={styles['slash-error-detail']}>
              {inlineError.detail && <p className={styles['slash-error-detail-line']}>{inlineError.detail}</p>}
              {inlineError.code && <p className={styles['slash-error-detail-code']}>{inlineError.code}</p>}
            </div>
          )}
          {(inlineError.code === TURN_INTERRUPTED_ERROR_CODE || onDismissError) && (
            <div className={styles['slash-error-actions']}>
              {inlineError.code === TURN_INTERRUPTED_ERROR_CODE && onRetryTurn && (
                <button
                  type="button"
                  className={styles['slash-error-toggle']}
                  onClick={onRetryTurn}
                  disabled={turnActionBusy}
                >
                  {t('error.retryTurn')}
                </button>
              )}
              {inlineError.code === TURN_INTERRUPTED_ERROR_CODE && onContinueTask && (
                <button
                  type="button"
                  className={styles['slash-error-toggle']}
                  onClick={onContinueTask}
                  disabled={turnActionBusy}
                >
                  {t('error.continueTask')}
                </button>
              )}
              {onDismissError && (
                <button
                  type="button"
                  className={styles['slash-error-toggle']}
                  onClick={onDismissError}
                >
                  {t('error.dismiss')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {modelUnavailableMessage && (
        <div className={styles['slash-error-bar']} role="status">
          <span className={styles['slash-error-dot']} />
          <span>{modelUnavailableMessage}</span>
        </div>
      )}
      {!slashBusy && !compacting && !screenshotBusy && !inlineError && !modelUnavailableMessage && slashResult && (
        <div
          className={`${styles['slash-busy-bar']}${resultClickable ? ` ${styles['slash-busy-bar-clickable']}` : ''}`}
          onClick={onResultClick}
          role={resultClickable ? 'button' : undefined}
        >
          <span className={styles[slashResult.type === 'success' ? 'slash-result-dot-ok' : 'slash-result-dot-err']} />
          <span>{slashResult.text}</span>
        </div>
      )}
    </>
  );
});
