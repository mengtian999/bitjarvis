/**
 * CyberEggPage — 「赛博鸡蛋」：AIHOT Token 羊毛的桌面端原生页面。
 *
 * 数据不直链 aihot.news，而是走本地 server 代理
 *   GET /api/cyber-egg/feed?force=0|1
 * 该代理具备：内存缓存（5 min）→ 磁盘缓存（jarvisHome/cache）→ 随包基线
 * 三级兜底，断网/远端挂了页面依然可用，只标「数据可能过期」。
 *
 * 页面特点：
 *   - 全 React 原生渲染，无 iframe，支持 5 套桌面主题 CSS 变量
 *   - 分组筛选（全部 / 每天 / 每月 / 其他福利）+ 关键词搜索
 *   - 「去领」走 window.jarvis.openExternal → 系统默认浏览器
 *   - 「已领」仅本地 localStorage 标记，不跨端
 *   - 手动刷新受服务端 minGap（2 min）限流，防误触
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useStore } from '../../stores';
import { jarvisFetch } from '../../hooks/use-jarvis-fetch';
import {
  CYBER_EGG_DEFAULT_BASE_URL,
  CyberEggFeed,
  CyberEggItem,
  CyberEggSection,
  cyberEggPeriodLabelKey,
  normalizeCyberEggFeed,
} from '../../../../../shared/cyber-egg-contract';

declare function t(key: string, vars?: Record<string, string | number>): string;

type ItemCardProps = {
  item: CyberEggFeed['items'][number];
  claimedIds: Set<string>;
  onClaim: (id: string) => void;
};

function ItemCard({ item, claimedIds, onClaim }: ItemCardProps) {
  const t = window.t ?? ((p: string) => String(p));
  const claimed = claimedIds.has(item.id);
  const periodKey = cyberEggPeriodLabelKey(item.grant.period);
  const periodLabel =
    periodKey ? t(periodKey) : (item.grant.period || '');
  const cny = item.grant.cny != null ? `≈¥${item.grant.cny}` : null;
  const regionLabel =
    item.region === 'cn'
      ? t('cyberegg.region.cn')
      : item.region === 'intl'
        ? t('cyberegg.region.intl')
        : null;
  const verifyLabel =
    item.verifyStatus === 'verified'
      ? t('cyberegg.verify.verified')
      : item.verifyStatus === 'stale'
        ? t('cyberegg.verify.stale')
        : item.verifyStatus === 'unverified'
          ? t('cyberegg.verify.unverified')
          : null;
  const sourceLabel =
    item.sources && item.sources.length > 1
      ? t('cyberegg.sourceBoth')
      : item.sources?.[0] === 'tokenmost'
        ? 'TokenMost'
        : item.sources?.[0] === 'aihot'
          ? 'AIHOT'
          : null;

  return (
    <article
      className={`cyber-egg-card${item.expired ? ' expired' : ''}${
        claimed ? ' claimed' : ''
      }`}
    >
      <div className="cyber-egg-card-head">
        <h3 className="cyber-egg-title">{item.title}</h3>
        <span className="cyber-egg-provider">{item.provider}</span>
      </div>
      <div className="cyber-egg-grant">
        <b>{item.grant.text}</b>
        {periodLabel && <span className="cyber-egg-period">{periodLabel}</span>}
        {cny && <span className="cyber-egg-cny">{cny}</span>}
        {item.expired && <span className="cyber-egg-badge">已结束</span>}
      </div>
      {(regionLabel || verifyLabel || sourceLabel || item.category) && (
        <div className="cyber-egg-chips-row">
          {regionLabel && (
            <span className={`cyber-egg-region ${item.region === 'cn' ? 'cn' : 'intl'}`}>
              {regionLabel}
            </span>
          )}
          {verifyLabel && (
            <span
              className={`cyber-egg-verify${
                item.verifyStatus === 'verified' ? ' ok' : ''
              }`}
            >
              {verifyLabel}
            </span>
          )}
          {item.category && <span className="cyber-egg-cat">{item.category}</span>}
          {sourceLabel && <span className="cyber-egg-cat">{sourceLabel}</span>}
        </div>
      )}
      {item.requirements?.length && (
        <ul className="cyber-egg-tags">
          {item.requirements?.map((req: string, i: number) => (
            <li key={i}>{req}</li>
          ))}
        </ul>
      )}
      {item.how && <p className="cyber-egg-how">{item.how}</p>}
      {item.appliesTo && (
        <details className="cyber-egg-details">
          <summary>{t('cyberegg.appliesTo')}</summary>
          <p>{item.appliesTo}</p>
        </details>
      )}
      <div className="cyber-egg-foot">
        <span className="cyber-egg-meta">
          {item.validity && `有效期：${item.validity} · `}
          {item.deadline && `截止 ${new Date(item.deadline).toLocaleString('zh-CN')} · `}
          {item.verifiedAt && `核实 ${new Date(item.verifiedAt).toLocaleString('zh-CN')}`}
        </span>
        {item.claimUrl && (
          <button
            className="cyber-egg-claim"
            disabled={claimed || item.expired}
            onClick={() => onClaim(item.id)}
          >
            {claimed ? t('cyberegg.claimed') : t('cyberegg.claim')}
          </button>
        )}
      </div>
    </article>
  );
}
export function CyberEggPage() {
  const locale = useStore(s => s.locale);
  const [feed, setFeed] = useState<CyberEggFeed | null>(null);
  const [origin, setOrigin] = useState<'live' | 'disk' | 'bundled' | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSection, setActiveSection] = useState('all');
  const [activeRegion, setActiveRegion] = useState<'all' | 'cn' | 'intl'>('all');
  const [query, setQuery] = useState('');
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const lastRefreshRef = useRef<number>(0);

  const t = window.t ?? ((p: string) => String(p));

  const loadFeed = useCallback(async (force = false) => {
    try {
      const res = await jarvisFetch(
        `/api/cyber-egg/feed${force ? '?force=1' : ''}`,
        { throwOnHttpError: false, timeout: 15_000 }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        ok?: boolean;
        feed?: unknown;
        origin?: string;
        warning?: string;
      };
      if (!data.ok || !data.feed) {
        throw new Error(data.warning || '返回数据异常');
      }
      const normalized = normalizeCyberEggFeed(data.feed);
      if (!normalized) {
        throw new Error('数据契约校验失败');
      }
      setFeed(normalized);
      setOrigin(
        (data.origin === 'live' || data.origin === 'disk' || data.origin === 'bundled'
          ? data.origin
          : 'live') as 'live' | 'disk' | 'bundled',
      );
      setWarning(data.warning || null);
    } catch (err) {
      setWarning(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    void loadFeed();
  }, [locale, loadFeed]);

  const claimedJson = localStorage.getItem('cyberegg-claimed');
  useEffect(() => {
    try {
      if (claimedJson) {
        setClaimedIds(new Set(JSON.parse(claimedJson)));
      }
    } catch {
      // ignore
    }
  }, [claimedJson]);

  const handleClaim = useCallback(
    (id: string) => {
      const next = new Set(claimedIds);
      next.add(id);
      setClaimedIds(next);
      try {
        localStorage.setItem('cyberegg-claimed', JSON.stringify([...next]));
      } catch {
        // ignore
      }
    },
    [claimedIds],
  );

  const openClaimUrl = useCallback((url: string) => {
    if (typeof window.jarvis?.openExternal === 'function') {
      void window.jarvis.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < 60_000) {
      return;
    }
    lastRefreshRef.current = now;
    setRefreshing(true);
    await loadFeed(true);
    setRefreshing(false);
  }, [loadFeed]);
  const sections = feed ? feed.sections : [];
  const items = feed ? feed.items : [];
  const filteredItems = items.filter((item: CyberEggItem) => {
    if (activeRegion !== 'all' && item.region !== activeRegion) return false;
    if (activeSection !== 'all' && item.section !== activeSection) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    const haystack = [
      item.title,
      item.provider,
      item.grant.text,
      item.grant.note,
      item.how,
      item.appliesTo,
      item.category,
      ...(item.requirements ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  const regionCounts = {
    cn: items.filter((i: CyberEggItem) => i.region === 'cn').length,
    intl: items.filter((i: CyberEggItem) => i.region === 'intl').length,
  };
  const regionTabs: Array<{ key: 'all' | 'cn' | 'intl'; label: string; count: number }> = [
    { key: 'all', label: t('cyberegg.region.all'), count: items.length },
    { key: 'cn', label: t('cyberegg.region.cn'), count: regionCounts.cn },
    { key: 'intl', label: t('cyberegg.region.intl'), count: regionCounts.intl },
  ];

  const tabs = [
    { key: 'all', label: t('cyberegg.section.all'), count: filteredItems.length },
    ...sections.map((sec: CyberEggSection) => ({
      key: sec.key,
      label: sec.title,
      count: filteredItems.filter((i: CyberEggItem) => i.section === sec.key).length,
    })),
  ];

  return (
    <section className="cyber-egg-page">
      <header className="cyber-egg-header">
        <div className="cyber-egg-brand">
          <span className="cyber-egg-egg">🥚</span>
          <div>
            <h1 className="cyber-egg-title">{t('cyberegg.title')}</h1>
            <p className="cyber-egg-subtitle">{t('cyberegg.subtitle')}</p>
          </div>
        </div>
        <div className="cyber-egg-actions">
          {origin && (
            <span className={`cyber-egg-origin ${origin}`}>
              {origin === 'live'
                ? t('cyberegg.origin.live')
                : origin === 'disk'
                  ? t('cyberegg.origin.disk')
                  : t('cyberegg.origin.bundled')}
            </span>
          )}
          <button
            className="cyber-egg-refresh"
            disabled={refreshing}
            onClick={handleRefresh}
            title={t('cyberegg.refresh')}
          >
            {refreshing ? t('cyberegg.refreshing') : t('cyberegg.refresh')}
          </button>
          <a
            className="cyber-egg-open"
            href={CYBER_EGG_DEFAULT_BASE_URL}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {t('cyberegg.openOriginal')}
          </a>
        </div>
      </header>

      {warning && (
        <div className="cyber-egg-alert">
          {t('cyberegg.stale', { warning })}
          <span className="cyber-egg-alert-link" onClick={handleRefresh}>
            {t('cyberegg.refreshAgain')}
          </span>
        </div>
      )}

      <div className="cyber-egg-summary">
        <div className="cyber-egg-stat">
          <b>{feed?.itemCount ?? 0}</b>
          <span>{t('cyberegg.itemsTotal')}</span>
        </div>
        <div className="cyber-egg-stat">
          <b>{regionCounts.cn}</b>
          <span>{t('cyberegg.region.cn')}</span>
        </div>
        <div className="cyber-egg-stat">
          <b>{regionCounts.intl}</b>
          <span>{t('cyberegg.region.intl')}</span>
        </div>
        <div className="cyber-egg-stat muted">
          <b>{feed?.items.filter((i: CyberEggItem) => i.expired).length ?? 0}</b>
          <span>{t('cyberegg.expiredCount')}</span>
        </div>
      </div>

      <div className="cyber-egg-toolbar">
        <nav className="cyber-egg-chips" aria-label={t('cyberegg.regionGroup')}>
          {regionTabs.map(tab => (
            <button
              key={tab.key}
              className={`cyber-egg-chip${activeRegion === tab.key ? ' active' : ''}`}
              data-region={tab.key}
              aria-pressed={activeRegion === tab.key}
              onClick={() => setActiveRegion(tab.key)}
            >
              {tab.label} <em>{tab.count}</em>
            </button>
          ))}
        </nav>
        <nav className="cyber-egg-chips" aria-label={t('cyberegg.sectionGroup')}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`cyber-egg-chip${
                activeSection === tab.key ? ' active' : ''
              }`}
              data-filter={tab.key}
              aria-pressed={activeSection === tab.key}
              onClick={() => setActiveSection(tab.key)}
            >
              {tab.label} <em>{tab.count}</em>
            </button>
          ))}
        </nav>
        <label className="cyber-egg-search">
          <span>{t('cyberegg.search')}</span>
          <input
            className="cyber-egg-search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('cyberegg.searchPlaceholder')}
          />
        </label>
      </div>
      <main className="cyber-egg-main">
        {loading && !feed ? (
          <div className="cyber-egg-empty">{t('cyberegg.loading')}</div>
        ) : filteredItems.length === 0 ? (
          <div className="cyber-egg-empty">{t('cyberegg.empty')}</div>
        ) : (
          <>
            {sections.map((sec: CyberEggSection) => {
              const visibleItems = filteredItems.filter(
                (i: CyberEggItem) => activeSection === 'all' || i.section === sec.key,
              );
              if (visibleItems.length === 0) return null;
              return (
                <section key={sec.key} className="cyber-egg-group">
                  <h2 className="cyber-egg-group-title">
                    {sec.title} <small>({visibleItems.length})</small>
                  </h2>
                  {visibleItems.map((item: CyberEggItem) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      claimedIds={claimedIds}
                      onClaim={(id: string) => {
                        handleClaim(id);
                        const it = items.find((x: CyberEggItem) => x.id === id);
                        if (it?.claimUrl) {
                          void openClaimUrl(it.claimUrl);
                        }
                      }}
                    />
                  ))}
                </section>
              );
            })}
          </>
        )}
      </main>

      <footer className="cyber-egg-footer">
        <p>
          {t('cyberegg.source')}{' '}
          <a
            href={CYBER_EGG_DEFAULT_BASE_URL}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            AIHOT · Token 羊毛
          </a>
          {feed?.source.updatedAt && (
            <span> · {t('cyberegg.updatedAt', {
              time: new Date(feed.source.updatedAt).toLocaleString('zh-CN'),
            })}</span>
          )}
        </p>
      </footer>
    </section>
  );
}
