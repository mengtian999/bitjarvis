// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/tts/tts-controller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/tts/tts-controller')>();
  return {
    ...actual,
    speakTts: vi.fn(() => Promise.resolve()),
    stopTts: vi.fn(),
  };
});

import { speakTts } from '../../components/tts/tts-controller';
import { ChannelMessages } from '../../components/ChannelsPanel';
import { useStore } from '../../stores';

const mockedSpeakTts = vi.mocked(speakTts);
const AUTOPLAY_KEY = 'jarvis-channel-tts-autoplay';

function seedStore() {
  useStore.setState({
    currentChannel: 'ch_crew',
    channels: [{
      id: 'ch_crew',
      name: 'crew',
      members: ['jarvis'],
      lastMessage: '',
      lastSender: '',
      lastTimestamp: '',
      newMessageCount: 0,
      isDM: false,
    }],
    channelMessages: [
      { sender: 'user', timestamp: '2026-05-07 17:00:00', body: 'old' },
    ],
    agents: [],
    userName: 'user',
    userAvatarUrl: '',
    currentAgentId: 'jarvis',
  } as never);
}

describe('ChannelMessages 自动朗读', () => {
  beforeEach(() => {
    window.t = ((key: string) => key) as typeof window.t;
    window.localStorage.removeItem(AUTOPLAY_KEY);
    mockedSpeakTts.mockClear();
    seedStore();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(AUTOPLAY_KEY);
  });

  it('开关开启时,新到的 agent 回复自动播报', () => {
    window.localStorage.setItem(AUTOPLAY_KEY, '1');
    render(
      <div className="channel-messages">
        <ChannelMessages />
      </div>,
    );
    // 初次水合不播报
    expect(mockedSpeakTts).not.toHaveBeenCalled();

    act(() => {
      useStore.setState({
        channelMessages: [
          { sender: 'user', timestamp: '2026-05-07 17:00:00', body: 'old' },
          { sender: 'jarvis', timestamp: '2026-05-07 17:01:00', body: '**新回复** `code`' },
        ],
      } as never);
    });

    expect(mockedSpeakTts).toHaveBeenCalledTimes(1);
    expect(mockedSpeakTts).toHaveBeenCalledWith(
      '新回复 code',
      { messageId: '2026-05-07 17:01:00-jarvis-1' },
    );
  });

  it('开关关闭时不播报', () => {
    render(
      <div className="channel-messages">
        <ChannelMessages />
      </div>,
    );
    act(() => {
      useStore.setState({
        channelMessages: [
          { sender: 'user', timestamp: '2026-05-07 17:00:00', body: 'old' },
          { sender: 'jarvis', timestamp: '2026-05-07 17:01:00', body: 'new reply' },
        ],
      } as never);
    });
    expect(mockedSpeakTts).not.toHaveBeenCalled();
  });

  it('自己发的消息不播报', () => {
    window.localStorage.setItem(AUTOPLAY_KEY, '1');
    render(
      <div className="channel-messages">
        <ChannelMessages />
      </div>,
    );
    act(() => {
      useStore.setState({
        channelMessages: [
          { sender: 'user', timestamp: '2026-05-07 17:00:00', body: 'old' },
          { sender: 'user', timestamp: '2026-05-07 17:01:00', body: 'mine' },
        ],
      } as never);
    });
    expect(mockedSpeakTts).not.toHaveBeenCalled();
  });

  it('发言人 agent 配置了音色时,播报按该音色传 voice', () => {
    window.localStorage.setItem(AUTOPLAY_KEY, '1');
    useStore.setState({
      agents: [
        { id: 'jarvis', name: 'Jarvis', yuan: 'jarvis', isPrimary: true, voice: 'zh-CN-XiaoxiaoNeural' },
      ],
    } as never);
    render(
      <div className="channel-messages">
        <ChannelMessages />
      </div>,
    );
    act(() => {
      useStore.setState({
        channelMessages: [
          { sender: 'user', timestamp: '2026-05-07 17:00:00', body: 'old' },
          { sender: 'jarvis', timestamp: '2026-05-07 17:01:00', body: '你好' },
        ],
      } as never);
    });
    expect(mockedSpeakTts).toHaveBeenCalledWith(
      '你好',
      { messageId: '2026-05-07 17:01:00-jarvis-1', voice: 'zh-CN-XiaoxiaoNeural' },
    );
  });
});
