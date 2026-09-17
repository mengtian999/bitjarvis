import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { jarvisFetch } from '../../api';
import { t } from '../../helpers';
import { SettingsSection } from '../../components/SettingsSection';
import { SettingsRow } from '../../components/SettingsRow';
import { SelectWidget, type SelectOption } from '@/ui';

interface LanguageOption {
  id: string;
  label: string;
  defaultVoice?: string;
  sampleText?: string;
}

interface ProvidersPayload {
  providers: Record<string, {
    models?: Array<{ id: string; languages?: LanguageOption[] }>;
  }>;
  config?: { language?: string };
}

/** UI locale("zh"/"zh-TW"/"ja"/"ko"/"en")→ 语音语言;未知回退 zh-CN。 */
export function localeToSpeechLanguage(locale: string | undefined | null): string {
  if (!locale) return 'zh-CN';
  if (locale === 'zh-TW' || locale === 'zh-Hant') return 'zh-TW';
  if (locale.startsWith('zh')) return 'zh-CN';
  if (locale.startsWith('ja')) return 'ja';
  if (locale.startsWith('ko')) return 'ko';
  if (locale.startsWith('en')) return 'en';
  return 'zh-CN';
}

/** 本地化语种名(i18n 缺失时回退服务端中性 label)。 */
export function speechLanguageLabel(lang: LanguageOption): string {
  const key = `settings.voice.languages.${lang.id}`;
  const localized = t(key);
  return localized === key ? (lang.label || lang.id) : localized;
}

/**
 * 语音语言 — 五语种(简中/繁中/日/韩/英)全局默认,同时驱动:
 * TTS 默认音色与 SSML 语言、云端 ASR language 参数、sherpa 本地模型目录选择。
 * 默认值跟随界面语言;一旦用户显式选择则以配置为准。
 */
export function VoiceLanguageSection() {
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [language, setLanguage] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setReady(false);
    try {
      const res = await jarvisFetch('/api/speech-generation/providers');
      const data: ProvidersPayload = await res.json();
      // 语言目录由 provider 声明下发(单一数据源 core/speech/speech-languages.ts)
      const declared: LanguageOption[] = [];
      for (const provider of Object.values(data?.providers || {})) {
        for (const model of provider.models || []) {
          for (const lang of model.languages || []) {
            if (!declared.some((l) => l.id === lang.id)) declared.push(lang);
          }
        }
      }
      setLanguages(declared);
      const configured = data?.config?.language || '';
      setLanguage(configured || localeToSpeechLanguage((window as any)?.i18n?.locale));
      setError(null);
    } catch (err) {
      setError(String((err as { message?: unknown })?.message || 'voice language load failed'));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const options: SelectOption[] = useMemo(
    () => languages.map((lang) => ({ value: lang.id, label: speechLanguageLabel(lang) })),
    [languages],
  );

  const save = useCallback(async (next: string) => {
    const prev = language;
    setLanguage(next);
    setError(null);
    try {
      // 同一份语言写入 TTS 与 ASR 配置,保持「语音语言」单点设置
      const results = await Promise.allSettled([
        jarvisFetch('/api/speech-generation/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: { language: next } }),
        }),
        jarvisFetch('/api/speech-recognition/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: { language: next } }),
        }),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
        const data = await result.value.json();
        if (data?.error) throw new Error(String(data.error));
      }
      // 通知音色面板刷新(按新语言过滤)
      window.dispatchEvent(new CustomEvent('voice-language-changed'));
    } catch (err) {
      setLanguage(prev);
      setError(String((err as { message?: unknown })?.message || 'voice language save failed'));
    }
  }, [language]);

  return (
    <SettingsSection title={t('settings.voice.language')} description={t('settings.voice.languageHint')}>
      <SettingsRow
        label={t('settings.voice.languageLabel')}
        control={(
          <SelectWidget
            value={language}
            disabled={!ready || options.length === 0}
            options={options.length ? options : [{ value: language || 'zh-CN', label: language || 'zh-CN', disabled: true as const }]}
            onChange={(val) => { if (val && val !== language) void save(val); }}
          />
        )}
      />
      {error && <SettingsSection.Note>{error}</SettingsSection.Note>}
    </SettingsSection>
  );
}
