// desktop/src/react/settings/tabs/voice/voice-catalog.ts
// 语音音色目录共享逻辑：SpeechGenerationPanel（全局默认音色）与 AgentTab（per-agent 音色）
// 共用同一套「provider 语言目录 → 音色列表」推导，避免多处复制漂移。
import { useCallback, useEffect, useState } from 'react';
import { jarvisFetch } from '../../api';
import { localeToSpeechLanguage } from './VoiceLanguageSection';

export interface VoiceOption { id: string; label: string; gender?: string }

export interface LanguageOption {
  id: string;
  label: string;
  defaultVoice?: string;
  voices?: VoiceOption[];
  sampleText?: string;
}

export interface TtsProvider {
  providerId: string;
  displayName?: string;
  models: Array<{ id: string; name?: string; protocolId?: string; languages?: LanguageOption[] }>;
  hasCredentials: boolean;
}

export interface TtsConfig {
  enabled?: boolean;
  defaultModel?: { provider: string; id: string };
  voice?: string;
  rate?: number | string;
  language?: string;
}

export interface TtsModelEntry {
  provider: string;
  id: string;
  name: string;
  hasCredentials: boolean;
  languages?: LanguageOption[];
}

/** 服务端未声明音色目录时的兜底（provider 声明是数据源，此表仅兜底显示）。 */
export const FALLBACK_VOICES = [
  'zh-CN-XiaoxiaoNeural',
  'zh-TW-HsiaoChenNeural',
  'ja-JP-NanamiNeural',
  'ko-KR-SunHiNeural',
  'en-US-AriaNeural',
];

/** 把 providers 拍平成模型列表（模型选择器与音色推导共用）。 */
export function collectModels(providers: Record<string, TtsProvider>): TtsModelEntry[] {
  const out: TtsModelEntry[] = [];
  for (const pid of Object.keys(providers || {})) {
    const p = providers[pid];
    for (const m of p.models || []) {
      out.push({ provider: pid, id: m.id, name: m.name || m.id, hasCredentials: p.hasCredentials, languages: m.languages });
    }
  }
  return out;
}

export interface VoiceCatalog {
  voices: string[];
  languageEntry?: LanguageOption;
  providerVoices: VoiceOption[];
}

/**
 * 由 provider 目录推导当前可用音色列表，与改动前 SpeechGenerationPanel 逐字等价：
 * - microsoft-edge：优先 provider 声明的语言目录 voices，缺失回落默认音色 + 兜底表；
 * - 其它 provider：仅保留已配置音色，否则兜底表。
 */
export function deriveVoiceCatalog(
  providers: Record<string, TtsProvider>,
  config: TtsConfig | null,
  language: string,
): VoiceCatalog {
  const allModels = collectModels(providers);
  const defaultVal = config?.defaultModel ? `${config.defaultModel.provider}/${config.defaultModel.id}` : '';
  const edgeModel = allModels.find(m => `${m.provider}/${m.id}` === defaultVal && m.languages?.length);
  const languageEntry = edgeModel?.languages?.find(l => l.id === language);
  const providerVoices = languageEntry?.voices || [];
  const voices: string[] = config?.defaultModel?.provider === 'microsoft-edge'
    ? (providerVoices.length
      ? providerVoices.map(v => v.id)
      : (languageEntry?.defaultVoice
        ? [languageEntry.defaultVoice, ...FALLBACK_VOICES.filter(v => v !== languageEntry!.defaultVoice)]
        : FALLBACK_VOICES))
    : (config?.voice ? [config.voice] : FALLBACK_VOICES);
  return { voices, languageEntry, providerVoices };
}

/** 音色下拉展示文案：provider 声明了 label 时用「label · id」，否则裸 id。 */
export function voiceLabel(voiceId: string, providerVoices: VoiceOption[]): string {
  const declared = providerVoices.find(v => v.id === voiceId);
  if (declared) return declared.label ? `${declared.label} · ${voiceId}` : voiceId;
  return voiceId;
}

export interface VoiceCatalogState {
  providers: Record<string, TtsProvider>;
  config: TtsConfig | null;
  ready: boolean;
  error: string | null;
  reload: () => void;
}

/** 拉取 /api/speech-generation/providers（provider 目录 + 全局 tts 配置），跟随语音语言变化刷新。 */
export function useVoiceCatalog(): VoiceCatalogState {
  const [providers, setProviders] = useState<Record<string, TtsProvider>>({});
  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setReady(false);
    try {
      const res = await jarvisFetch('/api/speech-generation/providers');
      const data = await res.json();
      setProviders(data?.providers || {});
      setConfig(data?.config || null);
      setError(null);
    } catch (err) {
      setError(String((err as { message?: unknown })?.message || 'tts load failed'));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const handler = () => { void reload(); };
    window.addEventListener('voice-language-changed', handler);
    return () => window.removeEventListener('voice-language-changed', handler);
  }, [reload]);

  return { providers, config, ready, error, reload };
}

/** 当前生效的语音语言：全局 tts 配置 language 优先，否则跟随界面 locale。 */
export function resolveVoiceLanguage(config: TtsConfig | null): string {
  return config?.language || localeToSpeechLanguage((window as any)?.i18n?.locale);
}
