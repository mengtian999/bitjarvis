// desktop/src/react/components/SessionForwardDialog.tsx
import { memo, useMemo, useState } from 'react';
import { useStore } from '../stores';
import { useI18n } from '../hooks/use-i18n';
import { getWebSocket } from '../services/websocket';
import { switchSession } from '../stores/session-actions';
import { Overlay } from '../ui';
import dialogStyles from '../ui/ConfirmDialog.module.css';
import styles from './SessionForwardDialog.module.css';

/** 与 InputArea 的 createClientUserMessageId 同构：乐观插入用的本地消息 id。 */
function createClientUserMessageId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * SessionForwardDialog — 「转发到其他对话」的 Agent 会话选择器。
 *
 * store.sessionForwardText 非空时弹出：列出全部 Agent 会话（排除当前会话），
 * 选中后把草稿作为一条 user 消息（type: 'prompt'）直发到目标会话，
 * 目标会话自动开始 agent 回合——与会话内「转发到角色会话」同一套拷贝语义。
 *
 * 同时服务两个入口：
 *  - 桌面 Agent 消息操作「转发到其他对话」（MessageActions）；
 *  - 内嵌 IM 的「贾维斯」转发（im/forward-to-agent postMessage → ImView）。
 */
export const SessionForwardDialog = memo(function SessionForwardDialog() {
  const { t } = useI18n();
  const sessionForwardText = useStore(s => s.sessionForwardText);
  const setSessionForwardText = useStore(s => s.setSessionForwardText);
  const sessions = useStore(s => s.sessions);
  const currentSessionPath = useStore(s => s.currentSessionPath);

  const [filter, setFilter] = useState('');

  const candidates = useMemo(() => {
    if (!sessionForwardText) return [];
    const kw = filter.trim().toLowerCase();
    return sessions
      .filter(s => s.path !== currentSessionPath)
      .filter(s => {
        if (!kw) return true;
        const hay = `${s.title || ''}\n${s.firstMessage || ''}\n${s.agentName || ''}`.toLowerCase();
        return hay.includes(kw);
      });
  }, [sessionForwardText, sessions, currentSessionPath, filter]);

  if (!sessionForwardText) return null;

  const forwardTo = (target: { path: string; sessionId?: string | null; agentId?: string | null }) => {
    const ws = getWebSocket();
    if (!ws || typeof ws.send !== 'function') return;
    const clientMessageId = createClientUserMessageId();
    ws.send(JSON.stringify({
      type: 'prompt',
      clientMessageId,
      text: sessionForwardText,
      sessionId: target.sessionId,
      sessionPath: target.path,
      displayMessage: { text: sessionForwardText },
    }));
    setFilter('');
    setSessionForwardText(null);
    // 转发后直达目标会话（与移动端 ImForwardActivity 的深链导航一致）。
    void switchSession(target.path);
  };

  return (
    <Overlay
      scope="window"
      open
      onClose={() => setSessionForwardText(null)}
      backdrop="blur"
      zIndex={150}
      className={dialogStyles.dialog}
      disableContainerAnimation
    >
      <h3 className={dialogStyles.title}>{t('common.forwardToSession')}</h3>
      <div className={`${dialogStyles.body} ${styles.body}`}>
        <input
          className={styles.search}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('common.forwardToSessionSearch')}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          // 保持弹窗打开：点击搜索框不应触发遮罩的关闭逻辑
          onClick={e => e.stopPropagation()}
        />
        <div className={styles.list}>
          {candidates.length === 0 ? (
            <div className={styles.empty}>{t('common.forwardToSessionEmpty')}</div>
          ) : (
            candidates.map(s => (
              <button
                key={s.path}
                type="button"
                className={styles.row}
                onClick={() => forwardTo(s)}
              >
                <span className={styles.rowTitle}>
                  {s.title || s.firstMessage || s.path}
                </span>
                <span className={styles.rowAgent}>{s.agentName || s.agentId || ''}</span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className={dialogStyles.actions}>
        <button
          type="button"
          className={dialogStyles.action}
          onClick={() => setSessionForwardText(null)}
        >
          {t('common.cancel')}
        </button>
      </div>
    </Overlay>
  );
});
