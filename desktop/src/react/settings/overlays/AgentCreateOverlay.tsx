import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '../store';
import { isJarvisFetchTimeout, jarvisFetch } from '../api';
import { t } from '../helpers';
import { loadAgents, switchToAgent } from '../actions';
import { Overlay } from '../../ui';
import styles from '../Settings.module.css';
import { CharacterCardPreviewOverlay, type CharacterCardPlan } from './CharacterCardPreviewOverlay';

export function AgentCreateOverlay() {
  const showToast = useSettingsStore(s => s.showToast);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [yuan, setYuan] = useState('jarvis');
  const [creating, setCreating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [cardPlan, setCardPlan] = useState<CharacterCardPlan | null>(null);
  const [importMemory, setImportMemory] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = () => {
      setName('');
      setYuan('jarvis');
      setCardPlan(null);
      setImportMemory(false);
      setError('');
      setVisible(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener('jarvis-show-agent-create', handler);
    return () => window.removeEventListener('jarvis-show-agent-create', handler);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setCardPlan(null);
    setImportMemory(false);
    setDragActive(false);
    setError('');
  }, []);

  const create = async () => {
    if (creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      const message = t('settings.agent.nameRequired');
      setError(message);
      showToast(message, 'error');
      return;
    }

    setCreating(true);
    setError('');
    try {
      // 创建链路含 LLM 生成 agentId（后端超时 60s），用 120s 超时避免
      // 前端 30s 默认超时先 abort：前端 abort 不会取消后端执行，
      // 会造成“前端报失败、后端实际已注册成功”的假失败。
      const res = await jarvisFetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, yuan }),
        timeout: 120_000,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await switchToAgent(data.id);
      close();
      showToast(t('settings.agent.created', { name: data.name }), 'success');
    } catch (err: any) {
      // 超时不等于失败：后端可能仍在继续创建。先拉取列表核对，
      // 若已创建成功则直接切换，避免用户重试造出重复助手。
      if (isJarvisFetchTimeout(err)) {
        const recovered = await confirmAgentCreated(trimmed);
        if (recovered) {
          await switchToAgent(recovered.id);
          close();
          showToast(t('settings.agent.created', { name: recovered.name }), 'success');
          return;
        }
      }
      const detail = isJarvisFetchTimeout(err)
        ? t('settings.agent.createTimeout')
        : err.message;
      const message = t('settings.agent.createFailed') + ': ' + detail;
      setError(message);
      showToast(message, 'error');
    } finally {
      setCreating(false);
    }
  };

  /**
   * 创建请求超时后的确认：后端不受前端 abort 影响，
   * 可能稍后才完成注册。按名字回查最新列表命中即视为成功。
   */
  const confirmAgentCreated = async (trimmedName: string) => {
    try {
      await loadAgents();
      const agents = useSettingsStore.getState().agents || [];
      const matches = agents.filter((a: any) => a?.name === trimmedName);
      if (matches.length === 0) return null;
      // 同名多个时取最新创建的（列表按创建时间倒序或 id 较大者为准兜底）。
      return matches[matches.length - 1] ?? matches[0];
    } catch {
      return null;
    }
  };

  const planCardFile = async (file: File | null | undefined) => {
    if (!file || planning || creating) return;
    setPlanning(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await jarvisFetch('/api/character-cards/plan', {
        method: 'POST',
        body: form,
        timeout: 90_000,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCardPlan(data.plan);
      setImportMemory(false);
    } catch (err: any) {
      showToast(t('settings.characterCard.readFailed') + ': ' + err.message, 'error');
    } finally {
      setPlanning(false);
      setDragActive(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmCardImport = async () => {
    if (!cardPlan?.token || creating) return;
    setCreating(true);
    try {
      // 同 create()：底层走 createAgent，LLM 生成 ID 可能耗时，90s 不够时
      // 前端 abort 同样会造成假失败，这里与普通创建保持一致。
      const res = await jarvisFetch('/api/character-cards/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cardPlan.token, importMemory }),
        timeout: 120_000,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await switchToAgent(data.agent.id);
      close();
      showToast(t('settings.agent.created', { name: data.agent.name }), 'success');
    } catch (err: any) {
      if (isJarvisFetchTimeout(err)) {
        const planName = cardPlan?.agent?.name || '';
        const recovered = planName ? await confirmAgentCreated(planName) : null;
        if (recovered) {
          await switchToAgent(recovered.id);
          close();
          showToast(t('settings.agent.created', { name: recovered.name }), 'success');
          return;
        }
      }
      const detail = isJarvisFetchTimeout(err)
        ? t('settings.agent.createTimeout')
        : err.message;
      showToast(t('settings.characterCard.importFailed') + ': ' + detail, 'error');
    } finally {
      setCreating(false);
    }
  };

  const types = t('yuan.types') || {};
  const entries = Object.entries(types) as [string, any][];

  return (
    <>
    <Overlay
      scope="inline"
      open={visible && !cardPlan}
      onClose={close}
      backdrop="blur"
      closeOnBackdrop={!creating && !planning}
      closeOnEsc={!creating && !planning}
      zIndex={110}
      className={styles['agent-create-card']}
      disableContainerAnimation
    >
        <h3 className={styles['agent-create-title']}>{t('settings.agent.createTitle')}</h3>
        <div className={styles['settings-form-field']}>
          <input
            ref={inputRef}
            className={styles['settings-input']}
            type="text"
            placeholder={t('settings.agent.namePlaceholder')}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            disabled={creating}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); create(); }
              if (e.key === 'Escape' && !creating) close();
            }}
          />
        </div>
        {error && <div className={styles['settings-inline-error']} role="alert">{error}</div>}
        <div className={styles['settings-form-field']}>
          <div className="yuan-selector">
            <div className="yuan-chips">
              {entries.map(([key, meta]) => (
                <button
                  key={key}
                  className={`yuan-chip${key === yuan ? ' selected' : ''}`}
                  type="button"
                  disabled={creating || planning}
                  onClick={() => setYuan(key)}
                >
                  <img className="yuan-chip-avatar" src={`assets/${meta.avatar || 'Jarvis.png'}`} draggable={false} />
                  <div className="yuan-chip-info">
                    <span className="yuan-chip-name">{key === 'jarvis' ? 'jarvis' : key}</span>
                    {/* kong 的 label 是为设置页那条 6:1 横幅写的整句，塞进这里 100px
                        的方片会换行撑高整行，所以单独取一句短的；其它 yuan 的描述
                        本来就短，继续读 label。 */}
                    <span className="yuan-chip-desc">
                      {(key === 'kong' ? meta.shortLabel : undefined) || meta.label || ''}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={styles['settings-form-field']}>
          <input
            ref={fileRef}
            className={styles['character-card-file-input']}
            type="file"
            accept=".zip,.jarvis-package,.json,.yaml,.yml"
            onChange={(event) => planCardFile(event.target.files?.[0])}
          />
          <button
            type="button"
            className={`${styles['character-card-drop-target']} ${dragActive ? styles['character-card-drop-target-active'] : ''}`}
            disabled={creating || planning}
            onClick={() => fileRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              planCardFile(event.dataTransfer.files?.[0]);
            }}
          >
            <span className={styles['character-card-drop-plus']}>+</span>
            <span>{planning ? t('settings.characterCard.readingCard') : t('settings.characterCard.dropOrClick')}</span>
          </button>
        </div>
        <div className={styles['agent-create-actions']}>
          <button className={styles['agent-create-cancel']} onClick={close} disabled={creating || planning}>{t('settings.agent.cancel')}</button>
          <button className={styles['agent-create-confirm']} onClick={create} disabled={creating}>
            {creating ? t('settings.agent.creating') : t('settings.agent.confirm')}
          </button>
        </div>
    </Overlay>
    {visible && cardPlan && (
      <CharacterCardPreviewOverlay
        plan={cardPlan}
        mode="import"
        memoryChecked={importMemory}
        processing={creating}
        onMemoryChange={setImportMemory}
        onConfirm={confirmCardImport}
        onCancel={close}
      />
    )}
    </>
  );
}
