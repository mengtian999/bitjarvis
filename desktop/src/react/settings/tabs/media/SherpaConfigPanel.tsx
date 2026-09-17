import React, { useCallback, useEffect, useState } from 'react';
import { jarvisFetch } from '../../api';
import { t } from '../../helpers';
import { SettingsSection } from '../../components/SettingsSection';
import { SettingsRow } from '../../components/SettingsRow';
import { Button } from '@/ui';

interface SherpaStatus {
  ready: boolean;
  dir: string;
  bin: { offline: boolean; tts: boolean; offlinePath: string | null; ttsPath: string | null };
  models: { vad: boolean; asr: boolean; tts: boolean };
  languages?: Array<{ id: string; label: string; localAsr: boolean; localTts: boolean }>;
  config: { dir?: string; bin?: string };
}

const monoStyle: React.CSSProperties = { fontFamily: 'monospace', fontSize: '0.9em', background: 'var(--bg-secondary, #f0f0f0)', padding: '2px 6px', borderRadius: '4px' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '4px 8px', border: '1px solid var(--border-color, #ccc)', borderRadius: '4px', background: 'var(--bg-primary, #fff)', color: 'var(--text-primary, #333)' };
const badgeStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '4px' };

export function SherpaConfigPanel() {
  const [status, setStatus] = useState<SherpaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirInput, setDirInput] = useState('');
  const [binInput, setBinInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await jarvisFetch('/api/sherpa/status');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStatus(data);
      setDirInput(data.config?.dir || '');
      setBinInput(data.config?.bin || '');
    } catch (err) {
      setError(String((err as { message?: unknown })?.message || 'load failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const values: Record<string, string> = {};
      if (dirInput.trim()) values.dir = dirInput.trim();
      if (binInput.trim()) values.bin = binInput.trim();
      const res = await jarvisFetch('/api/sherpa/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSuccess(t('common.saved'));
      void loadStatus();
    } catch (err) {
      setError(String((err as { message?: unknown })?.message || 'save failed'));
    } finally {
      setSaving(false);
    }
  }, [dirInput, binInput, loadStatus]);

  const isReady = status?.ready;
  const allModelsPresent = status?.models?.vad && status?.models?.asr && status?.models?.tts;

  return (
    <SettingsSection title={t('settings.media.localEngine')} description={t('settings.media.localEngineHint')}>
      {/* 引擎状态 */}
      <SettingsRow
        label={t('settings.media.localEngineStatus')}
        control={
          <span style={badgeStyle}>
            {loading ? (
              <span>{t('common.loading')}</span>
            ) : isReady ? (
              <span style={{ color: 'var(--color-success, #22c55e)' }}>{t('settings.media.localEngineReady')}</span>
            ) : (
              <span style={{ color: 'var(--color-error, #ef4444)' }}>{t('settings.media.localEngineMissing')}</span>
            )}
          </span>
        }
      />
      {/* 路径信息 */}
      {status?.dir && (
        <SettingsRow
          label={t('settings.media.localEngineDir')}
          control={<code style={monoStyle}>{status.dir}</code>}
        />
      )}
      {/* 二进制状态 */}
      {status?.bin && (
        <SettingsRow
          label={t('settings.media.localEngineBinary')}
          control={
            <span>
              {status.bin.offline ? '✅' : '❌'} ASR
              {' | '}
              {status.bin.tts ? '✅' : '❌'} TTS
            </span>
          }
        />
      )}
      {/* 模型状态 */}
      {status?.models && (
        <SettingsRow
          label={t('settings.media.localEngineModels')}
          control={
            <span>
              {status.models.vad ? '✅' : '❌'} VAD
              {' | '}
              {status.models.asr ? '✅' : '❌'} ASR
              {' | '}
              {status.models.tts ? '✅' : '❌'} TTS
            </span>
          }
        />
      )}
      {/* 按语种的本地模型就绪清单(在线引擎各语种始终可用) */}
      {status?.languages && status.languages.length > 0 && (
        <SettingsRow
          label={t('settings.voice.localModelsByLanguage')}
          control={
            <span style={{ display: 'grid', gap: '2px' }}>
              {status.languages.map((lang) => (
                <span key={lang.id}>
                  {lang.localTts ? '🔊' : '·'} TTS {lang.localAsr ? '🎧' : '·'} ASR — {lang.label}
                </span>
              ))}
              <span style={{ opacity: 0.7, fontSize: '0.85em' }}>{t('settings.voice.localModelsHint')}</span>
            </span>
          }
        />
      )}
      {/* 自定义路径 */}
      <SettingsRow
        label={t('settings.media.localEngineDirCustom')}
        control={
          <input
            type="text"
            style={inputStyle}
            value={dirInput}
            onChange={(e) => setDirInput(e.target.value)}
            placeholder={status?.dir || t('settings.media.localEngineDirPlaceholder')}
          />
        }
      />
      <SettingsRow
        label={t('settings.media.localEngineBinCustom')}
        control={
          <input
            type="text"
            style={inputStyle}
            value={binInput}
            onChange={(e) => setBinInput(e.target.value)}
            placeholder={t('settings.media.localEngineBinPlaceholder')}
          />
        }
      />
      <SettingsRow
        label=""
        control={
          <Button onClick={saveConfig} disabled={saving || loading}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        }
      />
      {error && <SettingsSection.Note>{error}</SettingsSection.Note>}
      {success && <SettingsSection.Note>{success}</SettingsSection.Note>}
    </SettingsSection>
  );
}
