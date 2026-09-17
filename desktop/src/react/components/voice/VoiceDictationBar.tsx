// desktop/src/react/components/voice/VoiceDictationBar.tsx
// 免提语音条:听写/语音对话双模式开关 + 状态提示 + 流式中间结果。
// - 听写:转写文本通过 onFinalText 交给输入区,不触发 TTS。
// - 语音对话:识别文本发给当前会话的 Agent,回复在聊天窗口流式呈现并语音播报;
//   支持播报中开口打断(barge-in)。
//
// 导出:
//   useVoiceDictation  — 语音状态管理 hook
//   VoiceModePills    — 工具栏按钮(文字 pill / 图标两种变体)
//   VoiceInputOverlay  — 输入框内语音覆盖层(状态标签+波形+转写文字)
//   VoiceDictationBar  — 旧式独立条(默认导出,for ChannelsPanel)

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useStore } from '../../stores';
import { useRealtimeVoice } from './use-realtime-voice';
import type { RealtimeVoiceState } from './use-realtime-voice';
import styles from './VoiceDictation.module.css';

// ── Types ──

type VoiceMode = 'dictation' | 'conversation';

interface DictationHandlers {
  onFinalText: (text: string) => void;
  onInterimText?: (text: string) => void;
  onChannelMessageSent?: (msg: { channel: string; sender: string; timestamp: string; body: string }) => void;
  conversationTarget?: { kind: 'channel'; channelName: string };
}

export interface VoiceDictationState {
  mode: VoiceMode;
  interimText: string;
  errorText: string;
  voiceState: RealtimeVoiceState;
  active: boolean;
  hasConversationTarget: boolean;
  conversationHint: string;
  dictationHint: string;
  loading: boolean;
  toggle: () => void;
  switchMode: (mode: VoiceMode) => void;
}

// ── Hook: useVoiceDictation ──

export function useVoiceDictation(handlers: DictationHandlers) {
  const { onFinalText, onInterimText, onChannelMessageSent, conversationTarget } = handlers;
  const [interimText, setInterimText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [mode, setMode] = useState<VoiceMode>('dictation');
  const storeSessionPath = useStore((s: any) => typeof s.currentSessionPath === 'string' ? s.currentSessionPath : '');
  const sessionPath = conversationTarget ? '' : storeSessionPath;
  const channelName = conversationTarget?.kind === 'channel' ? conversationTarget.channelName : '';

  const { state: voiceState, start, stop } = useRealtimeVoice({
    onFinal: (text) => {
      if (mode === 'dictation') onFinalText(text);
      setInterimText('');
    },
    onInterim: (text) => {
      if (mode === 'dictation') {
        setInterimText(text);
        onInterimText?.(text);
      }
    },
    onError: (message) => {
      setErrorText(message);
    },
    onChannelMessageSent: (msg) => {
      onChannelMessageSent?.(msg);
    },
  });

  const active = voiceState !== 'idle';
  const hasConversationTarget = Boolean(channelName || sessionPath);

  const toggle = useCallback(() => {
    if (active) {
      stop();
      setInterimText('');
      setErrorText('');
      return;
    }
    setErrorText('');
    if (mode === 'conversation' && !hasConversationTarget) return;
    if (mode === 'conversation') {
      void start(channelName ? { mode: 'conversation', channelName } : { mode: 'conversation', sessionPath });
    } else {
      void start();
    }
  }, [active, stop, mode, hasConversationTarget, channelName, sessionPath, start]);

  const switchMode = useCallback((next: VoiceMode) => {
    if (next === mode) return;
    if (active) {
      stop();
      setInterimText('');
    }
    setMode(next);
  }, [mode, active, stop]);

  // 稳定化 state 引用: 用 useMemo 避免每次渲染都产生新对象,
  // 否则配合 onVoiceStateChange 回调 + 父组件 useState 会引发无限渲染循环
  // (Maximum update depth exceeded → 被 RegionalErrorBoundary 捕获 → 显示"此区域暂时无法显示")
  const state: VoiceDictationState = useMemo(() => ({
    mode,
    interimText,
    errorText,
    voiceState,
    active,
    hasConversationTarget,
    conversationHint: conversationTarget
      ? ''
      : mode === 'conversation' && !hasConversationTarget
        ? 'input.voiceConversationNoSession'
        : 'input.voiceConversationHint',
    dictationHint: 'input.voiceDictationHint',
    loading: voiceState === 'starting',
    toggle,
    switchMode,
    // 依赖项: 所有参与生成 state 内容的字段。
    // toggle/switchMode 已由 useCallback 稳定; storeSessionPath 选择器返回字符串也稳定,
    // 因此 effect 仅在语音状态/文本/模式真正变化时才触发回调。
  }), [mode, interimText, errorText, voiceState, active, hasConversationTarget, conversationTarget, toggle, switchMode]);

  return { state, toggle, switchMode, setMode };
}

// ── 状态标签映射 ──

function getTagLabel(state: RealtimeVoiceState, mode: VoiceMode, t: (key: string) => string): { emoji: string; label: string } {
  switch (state) {
    case 'listening':
      return { emoji: '🎙', label: t('input.voiceDictationListening') };
    case 'speech':
      return { emoji: '🎙', label: t('input.voiceDictationSpeaking') };
    case 'thinking':
      return { emoji: '💭', label: t('input.voiceConversationThinking') };
    case 'speaking':
      return { emoji: '🔊', label: t('input.voiceConversationSpeaking') };
    default:
      return { emoji: '', label: '' };
  }
}

function getTagHint(state: RealtimeVoiceState, mode: VoiceMode, dictationHint: string, conversationHint: string): string {
  if (state === 'listening') {
    return mode === 'dictation' ? dictationHint : conversationHint;
  }
  if (state === 'speaking' && mode === 'conversation') {
    return 'input.voiceConversationInterruptHint';
  }
  return '';
}

// ── Component: VoiceModePills (工具栏按钮, 文字 pill 变体) ──

interface VoiceModePillsProps {
  mode: VoiceMode;
  voiceState: RealtimeVoiceState;
  hasConversationTarget: boolean;
  disabled: boolean;
  onToggle: () => void;
  onSwitchMode: (mode: VoiceMode) => void;
  t: (key: string) => string;
  /** 'text' | 'icon' */
  variant?: 'text' | 'icon';
  fullscreen?: boolean;
}

export function VoiceModePills({
  mode,
  voiceState,
  hasConversationTarget,
  disabled,
  onToggle,
  onSwitchMode,
  t,
  variant = 'text',
  fullscreen = false,
}: VoiceModePillsProps) {
  const active = voiceState !== 'idle';
  const rootClass = fullscreen ? `${styles.voicePill} ${styles.fs}` : styles.voicePill;
  const iconRootClass = fullscreen ? `${styles.voiceIcon} ${styles.fs}` : styles.voiceIcon;

  if (variant === 'icon') {
    // 图标变体: 两个独立图标按钮
    const dictActive = active && mode === 'dictation';
    const convActive = active && mode === 'conversation';
    const convDisabled = disabled || (mode === 'conversation' && !hasConversationTarget && !active);

    return (
      <>
        <button
          type="button"
          className={`${iconRootClass}${dictActive ? ` ${styles.active}` : ''}`}
          onClick={() => { if (mode !== 'dictation') onSwitchMode('dictation'); onToggle(); }}
          disabled={disabled || (mode === 'conversation' && active)}
          title={t('input.voiceDictationHint')}
          aria-pressed={dictActive}
        >
          {dictActive && <span className={styles.voiceDot} />}
          <svg viewBox="0 0 16 16" width={fullscreen ? 14 : 11} height={fullscreen ? 14 : 11}>
            <rect x="6" y="2" width="4" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M3 8 C3 11 5 12.5 8 12.5 C11 12.5 13 11 13 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <line x1="8" y1="12.5" x2="8" y2="15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
        <button
          type="button"
          className={`${iconRootClass}${convActive ? ` ${styles.active}` : ''}`}
          onClick={() => { if (mode !== 'conversation') onSwitchMode('conversation'); onToggle(); }}
          disabled={convDisabled}
          title={t(hasConversationTarget ? 'input.voiceConversationHint' : 'input.voiceConversationNoSession')}
          aria-pressed={convActive}
        >
          {convActive && <span className={styles.voiceDot} />}
          <svg viewBox="0 0 16 16" width={fullscreen ? 14 : 11} height={fullscreen ? 14 : 11}>
            <circle cx="5" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="11" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M1 13 C1 10.5 3 9 5 9 C7 9 9 10.5 9 13" fill="none" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7 13 C7 10.5 9 9 11 9 C13 9 15 10.5 15 13" fill="none" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
        </button>
      </>
    );
  }

  // 文字 pill 变体
  const dictLabel = active && mode === 'dictation'
    ? `${getTagLabel(voiceState, mode, t).emoji} ${t('input.voiceDictationListening')}`
    : t('input.voiceModeDictation');
  const convLabel = active && mode === 'conversation'
    ? `${getTagLabel(voiceState, mode, t).emoji} ${t('input.voiceConversationThinking')}`
    : t('input.voiceModeConversation');

  return (
    <>
      <button
        type="button"
        className={`${rootClass}${active && mode === 'dictation' ? ` ${styles.active}` : ''}`}
        onClick={() => { if (mode !== 'dictation') onSwitchMode('dictation'); onToggle(); }}
        disabled={disabled || (mode === 'conversation' && active)}
        title={t('input.voiceDictationHint')}
        aria-pressed={active && mode === 'dictation'}
      >
        {active && mode === 'dictation' && <span className={styles.voiceDot} />}
        {dictLabel}
      </button>
      <button
        type="button"
        className={`${rootClass}${active && mode === 'conversation' ? ` ${styles.active}` : ''}`}
        onClick={() => { if (mode !== 'conversation') onSwitchMode('conversation'); onToggle(); }}
        disabled={disabled || (mode === 'conversation' && !hasConversationTarget && !active)}
        title={t(hasConversationTarget ? 'input.voiceConversationHint' : 'input.voiceConversationNoSession')}
        aria-pressed={active && mode === 'conversation'}
      >
        {active && mode === 'conversation' && <span className={styles.voiceDot} />}
        {convLabel}
      </button>
    </>
  );
}

// ── Component: VoiceInputOverlay (输入框内语音覆盖层) ──

interface VoiceInputOverlayProps {
  state: RealtimeVoiceState;
  mode: VoiceMode;
  interimText: string;
  errorText: string;
  dictationHint: string;
  conversationHint: string;
  t: (key: string) => string;
  fullscreen?: boolean;
}

export function VoiceInputOverlay({
  state,
  mode,
  interimText,
  errorText,
  dictationHint,
  conversationHint,
  t,
  fullscreen = false,
}: VoiceInputOverlayProps) {
  const rootClass = fullscreen ? `${styles.overlay} ${styles.fs}` : styles.overlay;
  const miniClass = `${rootClass} ${styles.mini}`;

  if (errorText) {
    return (
      <div className={rootClass}>
        <span className={styles.errorText} role="alert">{errorText}</span>
      </div>
    );
  }

  // 非活跃状态: 不渲染覆盖层
  if (state === 'idle') return null;

  const tag = getTagLabel(state, mode, t);
  const hint = getTagHint(state, mode, dictationHint, conversationHint);
  const isMini = mode === 'conversation' || state === 'thinking' || state === 'speaking';
  const cls = isMini ? miniClass : rootClass;

  // 生成波形条
  const barCount = fullscreen ? 12 : 8;
  const bars = generateWaveBars(barCount, state, mode);
  const svgWidth = fullscreen ? 200 : 160;
  const svgHeight = fullscreen ? 14 : 8;

  return (
    <div className={cls}>
      {/* 状态条(单行): 状态标签 + hint + 当前半句预览(accent 斜体) + 波形(同行右侧) */}
      <div className={styles.statusRow}>
        <span className={styles.statusTag}>
          {tag.emoji} {tag.label}
          {hint && <span className={styles.hintText}>{t(hint)}</span>}
        </span>
        {mode === 'dictation' && interimText && (
          <span className={styles.interimText}>{interimText}</span>
        )}
        {bars.length > 0 && (
          <svg className={styles.waveformInline} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
            <g>
              {bars.map((h, i) => (
                <rect
                  key={i}
                  x={barPos(i, barCount, svgWidth)}
                  y={(svgHeight - h) / 2}
                  width={fullscreen ? 4 : 3}
                  height={h}
                  rx={fullscreen ? 1.5 : 1}
                  fill={`rgba(var(--accent-rgb, 128,128,128), ${0.3 + Math.random() * 0.35})`}
                />
              ))}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}

// ── 辅助: 生成波形条高度 ──

function generateWaveBars(count: number, state: RealtimeVoiceState, mode: VoiceMode): number[] {
  if (state === 'thinking') {
    // 思考中: 稀疏的微弱条
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(i % 3 === 1 ? 4 + Math.random() * 4 : 2 + Math.random() * 2);
    }
    return result;
  }
  if (state === 'speaking') {
    // 播报中: 中等活跃
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(3 + Math.random() * 5);
    }
    return result;
  }
  if (state === 'speech') {
    // 说话中: 活跃
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(2 + Math.random() * 6);
    }
    return result;
  }
  // listening: 低活跃等待
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(i % 4 === 0 ? 4 + Math.random() * 4 : 2 + Math.random() * 3);
  }
  return result;
}

function barPos(index: number, total: number, svgWidth: number): number {
  const spacing = svgWidth / total;
  return index * spacing + spacing * 0.2;
}

// ── 默认导出: VoiceDictationBar (旧式独立条, for ChannelsPanel) ──

interface Props {
  t: (key: string) => string;
  disabled?: boolean;
  onFinalText: (text: string) => void;
  /** 流式中间结果回调,用于在输入框实时显示识别文字(仅听写模式) */
  onInterimText?: (text: string) => void;
  /** 对话模式目标:不传时默认发当前聊天会话;频道页传 { kind:'channel', channelName }。 */
  conversationTarget?: { kind: 'channel'; channelName: string };
  /** 频道语音对话:用户语音消息已入频道的回显(调用方据此更新频道消息列表)。 */
  onChannelMessageSent?: (msg: { channel: string; sender: string; timestamp: string; body: string }) => void;
  /** 语音状态变化回调:当传此 prop 时,组件只管理状态不渲染 UI */
  onVoiceStateChange?: (state: VoiceDictationState) => void;
}

export function VoiceDictationBar(props: Props) {
  const { t, disabled = false, onFinalText, onInterimText, conversationTarget, onChannelMessageSent, onVoiceStateChange } = props;
  const { state, toggle, switchMode } = useVoiceDictation({
    onFinalText,
    onInterimText,
    onChannelMessageSent,
    conversationTarget,
  });

  // 当 onVoiceStateChange 传入时,组件只管理状态不渲染 UI
  useEffect(() => {
    onVoiceStateChange?.(state);
  }, [state, onVoiceStateChange]);

  if (onVoiceStateChange) return null;

  const { mode, voiceState, interimText, errorText, active, hasConversationTarget, conversationHint, dictationHint } = state;

  const stateLabel = (m: VoiceMode): string => {
    if (voiceState === 'speech') return t('input.voiceDictationSpeaking');
    if (voiceState === 'thinking') return t('input.voiceConversationThinking');
    if (voiceState === 'speaking') return t('input.voiceConversationSpeaking');
    return t('input.voiceDictationListening');
  };

  const idleLabel = mode === 'conversation' ? t('input.voiceConversation') : t('input.voiceDictation');
  const label = active ? stateLabel(mode) : idleLabel;

  return (
    <div className={styles.bar}>
      <div className={styles.modeSwitch} role="tablist" aria-label={t('input.voiceModeSwitchLabel')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'dictation'}
          className={`${styles.modeTab}${mode === 'dictation' ? ` ${styles.modeTabActive}` : ''}`}
          onClick={() => switchMode('dictation')}
          disabled={active && mode !== 'dictation'}
          title={t('input.voiceDictationHint')}
        >
          {t('input.voiceModeDictation')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'conversation'}
          className={`${styles.modeTab}${mode === 'conversation' ? ` ${styles.modeTabActive}` : ''}`}
          onClick={() => switchMode('conversation')}
          disabled={active && mode !== 'conversation'}
          title={t('input.voiceConversationHint')}
        >
          {t('input.voiceModeConversation')}
        </button>
      </div>
      <button
        type="button"
        className={`${styles.button}${active ? ` ${styles.active}` : ''}`}
        onClick={toggle}
        disabled={disabled || (mode === 'conversation' && !hasConversationTarget)}
        title={mode === 'conversation' ? t('input.voiceConversationHint') : t('input.voiceDictationHint')}
        aria-pressed={active}
      >
        <span className={styles.dot} />
        {label}
      </button>
      {active && interimText && (
        <span className={styles.interimText}>{interimText}</span>
      )}
      {active && !interimText && <span className={styles.hint}>{mode === 'conversation' ? t('input.voiceConversationHint') : t('input.voiceDictationHint')}</span>}
      {errorText && <span className={styles.errorText} role="alert">{errorText}</span>}
    </div>
  );
}

export default VoiceDictationBar;