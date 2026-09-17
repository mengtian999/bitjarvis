import React, { useCallback, useEffect, useRef, useState } from 'react';
import { jarvisFetch } from '../../api';
import { t } from '../../helpers';
import { SettingsSection } from '../../components/SettingsSection';
import { SettingsRow } from '../../components/SettingsRow';
import { Button, SelectWidget, Toggle, type SelectOption } from '@/ui';
import { speechLanguageLabel } from '../voice/VoiceLanguageSection';
import {
  collectModels,
  deriveVoiceCatalog,
  resolveVoiceLanguage,
  voiceLabel,
  type TtsConfig,
  type TtsProvider,
} from '../voice/voice-catalog';
import { isChatTtsAutoPlayEnabled, setChatTtsAutoPlay } from '../../../components/tts/tts-preferences';

export function SpeechGenerationPanel() {
  const [providers, setProviders] = useState<Record<string, TtsProvider>>({});
  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // 助手回复自动朗读(渲染端本地开关,localStorage 持久化)
  const [autoPlayReplies, setAutoPlayReplies] = useState(isChatTtsAutoPlayEnabled);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setConfigReady(false);
    try {
      const res = await jarvisFetch('/api/speech-generation/providers');
      const data = await res.json();
      setProviders(data?.providers || {});
      setConfig(data?.config || null);
      setError(null);
    } catch (err) {
      setError(String((err as { message?: unknown })?.message || 'tts load failed'));
    } finally {
      setConfigReady(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // 语音语言切换后自动刷新音色列表
  useEffect(() => {
    const handler = () => { void load(); };
    window.addEventListener('voice-language-changed', handler);
    return () => window.removeEventListener('voice-language-changed', handler);
  }, [load]);
  useEffect(() => () => {
    if (audioRef.current) { try { audioRef.current.pause(); } catch { /* ignore */ } audioRef.current = null; }
  }, []);

  const save = useCallback(async (patch: Record<string, unknown>) => {
    const prev = config;
    const next = { ...(prev || {}), ...patch } as TtsConfig;
    setConfig(next);
    setError(null);
    try {
      await jarvisFetch('/api/speech-generation/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: next }),
      });
    } catch (err) {
      setConfig(prev);
      setError(String((err as { message?: unknown })?.message || 'tts save failed'));
    }
  }, [config]);

  const allModels = collectModels(providers);

  const enabled = !!config?.enabled;
  const defaultVal = config?.defaultModel ? `${config.defaultModel.provider}/${config.defaultModel.id}` : '';
  const language = resolveVoiceLanguage(config);

  const modelOptions: SelectOption[] = [
    ...(defaultVal && !allModels.some(m => `${m.provider}/${m.id}` === defaultVal)
      ? [{ value: defaultVal, label: defaultVal, disabled: true as const }]
      : []),
    ...allModels.map(m => ({
      value: `${m.provider}/${m.id}`,
      label: `${m.provider} / ${m.name}${m.hasCredentials ? '' : ` (${t('settings.media.credentialMissing')})`}`,
      disabled: !m.hasCredentials,
    })),
  ];

  const { voices, languageEntry, providerVoices } = deriveVoiceCatalog(providers, config, language);
  const voiceValue = config?.voice && voices.includes(config.voice) ? config.voice : voices[0];

  const preview = useCallback(async () => {
    if (previewing) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const sampleText = languageEntry?.sampleText || t('settings.voice.previewFallbackText');
      const res = await jarvisFetch('/api/speech-generation/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sampleText,
          ...(config?.defaultModel ? { providerId: config.defaultModel.provider, modelId: config.defaultModel.id } : {}),
          voice: voiceValue,
          rate: config?.rate,
          language,
        }),
      });
      const data = await res.json();
      if (data?.error) throw new Error(String(data.error));
      if (!data?.audio?.dataUrl) throw new Error('tts preview: no audio');
      if (audioRef.current) { try { audioRef.current.pause(); } catch { /* ignore */ } }
      const audio = new Audio(data.audio.dataUrl);
      audioRef.current = audio;
      audio.onended = () => setPreviewing(false);
      audio.onerror = () => { setPreviewing(false); setPreviewError(t('settings.voice.previewFailed')); };
      await audio.play();
    } catch (err) {
      setPreviewing(false);
      setPreviewError(String((err as { message?: unknown })?.message || t('settings.voice.previewFailed')));
    }
  }, [previewing, languageEntry, config, voiceValue, language]);

  return (
    <SettingsSection title={t('settings.media.speechSynthesis')} description={t('settings.media.ttsDescription')}>
      <SettingsRow
        label={t('settings.media.ttsEnabled')}
        control={(
          <Toggle
            ariaLabel={t('settings.media.ttsEnabled')}
            on={configReady ? enabled : undefined}
            onChange={(v) => void save({ enabled: v })}
          />
        )}
      />
      <SettingsRow
        label={t('settings.media.ttsDefaultModel')}
        control={(
          <SelectWidget
            value={defaultVal}
            disabled={!configReady}
            options={modelOptions}
            onChange={(val) => {
              if (!val) { void save({ defaultModel: null }); return; }
              const [provider, ...rest] = String(val).split('/');
              void save({ defaultModel: { provider, id: rest.join('/') } });
            }}
          />
        )}
      />
      {config?.defaultModel?.provider === 'microsoft-edge' && (
        <SettingsRow
          label={t('settings.media.ttsVoice')}
          control={(
            <SelectWidget
              value={voiceValue}
              options={voices.map(v => ({ value: v, label: voiceLabel(v, providerVoices) }))}
              onChange={(val) => void save({ voice: val || null })}
            />
          )}
        />
      )}
      {languageEntry && (
        <SettingsRow
          label={t('settings.voice.currentLanguage')}
          control={<span>{speechLanguageLabel(languageEntry)}</span>}
        />
      )}
      <SettingsRow
        label={t('settings.media.ttsRate')}
        control={(
          <SelectWidget
            value={String(config?.rate ?? 1)}
            options={[
              { value: '0.8', label: '0.8x' },
              { value: '1', label: '1x' },
              { value: '1.2', label: '1.2x' },
            ]}
            onChange={(val) => {
              const rate = val === '0.8' ? 0.8 : val === '1.2' ? 1.2 : 1;
              void save({ rate });
            }}
          />
        )}
      />
      <SettingsRow
        label={t('settings.media.ttsAutoPlayReplies')}
        control={(
          <Toggle
            ariaLabel={t('settings.media.ttsAutoPlayReplies')}
            on={autoPlayReplies}
            onChange={(v) => { setChatTtsAutoPlay(v); setAutoPlayReplies(v); }}
          />
        )}
      />
      <SettingsRow
        label={t('settings.voice.preview')}
        control={(
          <Button onClick={() => void preview()} disabled={!configReady || previewing}>
            {previewing ? t('settings.voice.previewing') : t('settings.voice.previewButton')}
          </Button>
        )}
      />
      {previewError && <SettingsSection.Note>{previewError}</SettingsSection.Note>}
      {error && <SettingsSection.Note>{error}</SettingsSection.Note>}
    </SettingsSection>
  );
}
