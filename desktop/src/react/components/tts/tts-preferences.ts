// desktop/src/react/components/tts/tts-preferences.ts
// TTS 自动朗读开关(localStorage 持久化,参照 jarvis-leaves-overlay 等既有惯例)。

const CHAT_AUTOPLAY_KEY = 'jarvis-chat-tts-autoplay';
const CHANNEL_AUTOPLAY_KEY = 'jarvis-channel-tts-autoplay';

function readFlag(key: string): boolean {
  try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
}

function writeFlag(key: string, on: boolean): void {
  try { window.localStorage.setItem(key, on ? '1' : '0'); } catch { /* ignore */ }
}

/** 助手回复流式结束后自动朗读(设置页语音面板开关)。 */
export function isChatTtsAutoPlayEnabled(): boolean {
  return readFlag(CHAT_AUTOPLAY_KEY);
}

export function setChatTtsAutoPlay(on: boolean): void {
  writeFlag(CHAT_AUTOPLAY_KEY, on);
}

/** 频道/群聊新消息自动朗读(频道头部开关)。 */
export function isChannelTtsAutoPlayEnabled(): boolean {
  return readFlag(CHANNEL_AUTOPLAY_KEY);
}

export function setChannelTtsAutoPlay(on: boolean): void {
  writeFlag(CHANNEL_AUTOPLAY_KEY, on);
}
