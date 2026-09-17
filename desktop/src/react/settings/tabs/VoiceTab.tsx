import React from 'react';
import { t } from '../helpers';
import { SettingsPage } from '../components/SettingsPrimitives';
import { VoiceLanguageSection } from './voice/VoiceLanguageSection';
import { SpeechRecognitionPanel } from './media/SpeechRecognitionPanel';
import { SpeechGenerationPanel } from './media/SpeechGenerationPanel';
import { SherpaConfigPanel } from './media/SherpaConfigPanel';

/**
 * 语音设置页 — 四节结构:
 * 1. 语音语言(五语种全局默认,驱动 TTS 音色/SSML/ASR 语言/本地模型选择)
 * 2. 语音识别(引擎与默认模型)
 * 3. 语音合成(引擎/音色/语速/试听)
 * 4. 本地引擎 sherpa(状态/路径/按语种模型就绪)
 */
export function VoiceTab() {
  return (
    <SettingsPage tab="voice" title={t('settings.tabs.voice')}>
      <VoiceLanguageSection />
      <SpeechRecognitionPanel />
      <SpeechGenerationPanel />
      <SherpaConfigPanel />
    </SettingsPage>
  );
}
