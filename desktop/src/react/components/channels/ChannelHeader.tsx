/**
 * ChannelHeader — 频道头部（名称、成员数、操作按钮）
 */

import { useCallback, useState } from 'react';
import { useStore } from '../../stores';
import { useI18n } from '../../hooks/use-i18n';
import { deleteChannel } from '../../stores/channel-actions';
import { isChannelTtsAutoPlayEnabled, setChannelTtsAutoPlay } from '../tts/tts-preferences';
import { ContextMenu, type ContextMenuItem } from '../../ui';
import styles from './Channels.module.css';

function confirmDeleteChannel(channelId: string) {
  const ch = useStore.getState().channels.find((c) => c.id === channelId);
  const displayName = ch?.name || channelId;
  const msg = window.t('channel.deleteConfirm', { name: displayName }) || '';
  if (!confirm(msg)) return;
  deleteChannel(channelId);
}

export function ChannelHeader() {
  const { t } = useI18n();
  const headerName = useStore(s => s.channelHeaderName);
  const headerMembers = useStore(s => s.channelHeaderMembersText);
  const currentChannel = useStore(s => s.currentChannel);
  const isDM = useStore(s => s.channelIsDM);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [menuItems, setMenuItems] = useState<ContextMenuItem[]>([]);
  // 频道自动朗读开关(localStorage 持久化,新到的 agent 回复自动播报)
  const [autoPlay, setAutoPlay] = useState(isChannelTtsAutoPlayEnabled);

  const handleToggleAutoPlay = useCallback(() => {
    setAutoPlay(prev => {
      const next = !prev;
      setChannelTtsAutoPlay(next);
      return next;
    });
  }, []);

  const handleMenu = useCallback((e: React.MouseEvent) => {
    if (!currentChannel) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuItems([
      {
        label: t('channel.deleteChannel'),
        danger: true,
        action: () => confirmDeleteChannel(currentChannel),
      },
    ]);
    setMenuPos({ x: rect.left, y: rect.bottom + 4 });
  }, [currentChannel, t]);

  const handleCloseMenu = useCallback(() => {
    setMenuPos(null);
  }, []);

  return (
    <div className={styles.channelHeader}>
      <div className={styles.channelHeaderInfo}>
        <span className={styles.channelHeaderName}>{headerName}</span>
        <span className={styles.channelHeaderMembers}>{headerMembers}</span>
      </div>
      <div className={styles.channelHeaderActions}>
        {currentChannel && (
          <button
            className={styles.channelHeaderActionBtn}
            title={autoPlay ? t('channel.autoPlayDisable') : t('channel.autoPlayEnable')}
            aria-label={autoPlay ? t('channel.autoPlayDisable') : t('channel.autoPlayEnable')}
            aria-pressed={autoPlay}
            data-active={autoPlay ? 'true' : undefined}
            onClick={handleToggleAutoPlay}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </button>
        )}
        {currentChannel && !isDM && (
          <button
            className={styles.channelHeaderActionBtn}
            title={t('common.more')}
            onClick={handleMenu}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </button>
        )}
      </div>
      {menuPos && (
        <ContextMenu items={menuItems} position={menuPos} onClose={handleCloseMenu} />
      )}
    </div>
  );
}
