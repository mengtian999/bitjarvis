import React, { useCallback, useEffect, useState } from 'react';
import { jarvisFetch } from '../../api';
import { t } from '../../helpers';
import { SettingsSection } from '../../components/SettingsSection';
import { SettingsRow } from '../../components/SettingsRow';
import { SelectWidget, Toggle } from '@/ui';

interface SpeechModel {
  id: string;
  name?: string;
  displayName?: string;
  protocolId?: string;
  adapterAvailable?: boolean;
}

interface SpeechProvider {
  providerId: string;
  displayName?: string;
  hasCredentials: boolean;
  unavailableReason?: string | null;
  models: SpeechModel[];
  availableModels?: { id: string; name: string }[];
}

interface SpeechConfig {
  enabled: boolean;
  defaultModel?: { id: string; provider: string };
}

const LOADING_SELECT_VALUE = '__loading';

export function SpeechRecognitionPanel() {
  const [providers, setProviders] = useState<Record<string, SpeechProvider>>({});
  const [config, setConfig] = useState<SpeechConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setConfigReady(false);
    setError(null);
    try {
      const res = await jarvisFetch('/api/speech-recognition/providers');
      const data = await res.json();
      setProviders(data?.providers || {});
      setConfig(data?.config ? { enabled: false, ...data.config } : { enabled: false });
    } catch (err) {
      setError(String((err as { message?: unknown })?.message || 'load failed'));
    } finally {
      setConfigReady(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (patch: Record<string, unknown>) => {
    const prev = config;
    const next = { ...(prev || { enabled: false }), ...patch } as SpeechConfig;
    setConfig(next);
    setError(null);
    try {
      const res = await jarvisFetch('/api/speech-recognition/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: next }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
    } catch (err) {
      setConfig(prev);
      setError(String((err as { message?: unknown })?.message || 'save failed'));
    }
  }, [config]);

  const enabled = !!config?.enabled;
  const defaultModel = config?.defaultModel;
  const defaultValue = defaultModel ? `${defaultModel.provider}/${defaultModel.id}` : '';

  // 收集所有语音识别模型
  const allModels: Array<{ provider: string; id: string; name: string; adapterAvailable?: boolean }> = [];
  for (const pid of Object.keys(providers || {})) {
    const p = providers[pid];
    for (const m of p.models || []) {
      if (m.adapterAvailable !== false) {
        allModels.push({ provider: pid, id: m.id, name: m.displayName || m.name || m.id, adapterAvailable: m.adapterAvailable });
      }
    }
  }

  const modelOptions = [
    ...(configReady ? [{ value: '', label: '—' }] : [{ value: LOADING_SELECT_VALUE, label: t('common.loading'), disabled: true as const }]),
    ...(configReady && defaultValue && !allModels.some(m => `${m.provider}/${m.id}` === defaultValue)
      ? [{ value: defaultValue, label: `${defaultModel!.provider} / ${defaultModel!.id}`, disabled: true as const }]
      : []),
    ...(configReady && enabled ? allModels.map(m => ({
      value: `${m.provider}/${m.id}`,
      label: `${m.provider} / ${m.name}`,
    })) : []),
  ];

  return (
    <SettingsSection title={t('settings.media.speechRecognition')} description={t('settings.media.speechRecognitionHint')}>
      <SettingsRow
        label={t('settings.media.speechRecognitionEnabled')}
        control={
          <Toggle
            ariaLabel={t('settings.media.speechRecognitionEnabled')}
            on={configReady ? enabled : undefined}
            onChange={(v) => void save({ enabled: v })}
          />
        }
      />
      <SettingsRow
        label={t('settings.media.defaultSpeechModel')}
        control={
          <SelectWidget
            value={defaultValue}
            onChange={(val) => {
              if (val === LOADING_SELECT_VALUE) return;
              if (!val) { void save({ defaultModel: null }); return; }
              const [provider, ...rest] = String(val).split('/');
              void save({ defaultModel: { id: rest.join('/'), provider } });
            }}
            disabled={!configReady || !enabled || (allModels.length === 0 && !defaultValue)}
            options={modelOptions}
          />
        }
      />
      {error && <SettingsSection.Note>{error}</SettingsSection.Note>}
    </SettingsSection>
  );
}