import { memo, useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useStore } from '../stores';
import { jarvisFetch } from '../hooks/use-jarvis-fetch';

/**
 * 获取当前 DOM 上设置的具体主题 ID 和是否是暗色主题
 */
function getThemeInfo() {
  const theme = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) || 'warm-paper';
  const isDark = theme.includes('midnight') || theme.includes('dark');
  return { theme, isDark };
}

// IM 绑定状态横幅里的小按钮 / 输入框样式（与 ImView 其余内联风格一致）
const miniBtnStyle: CSSProperties = {
  padding: '2px 8px',
  fontSize: '11px',
  background: 'transparent',
  color: 'inherit',
  border: '1px solid currentColor',
  borderRadius: '4px',
  cursor: 'pointer',
};
const inputStyle: CSSProperties = {
  flex: '1',
  minWidth: '180px',
  padding: '3px 6px',
  fontSize: '12px',
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--border, rgba(128,128,128,0.3))',
  borderRadius: '4px',
  outline: 'none',
};

/**
 * ImView — 嵌入 FluffyChat (/im) Flutter Web 主界面视图
 */
export const ImView = memo(function ImView() {
  const serverPort = useStore(s => s.serverPort);
  const [loaded, setLoaded] = useState(false);
  const [themeInfo, setThemeInfo] = useState(getThemeInfo);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── Matrix 绑定状态（轮询 GET /api/bridge/matrix/status）──
  // 让“登录 IM 后看不到任何绑定迹象”的故障可见：未配置 registrar / 未绑定 / 已绑定
  // 三态 + 错误原因，并提供 as-registrar 地址与令牌的填写入口（打包 app 无环境变量）。
  const [mxStatus, setMxStatus] = useState<any>(null);
  const [regUrl, setRegUrl] = useState('');
  const [regToken, setRegToken] = useState('');
  const [regSaving, setRegSaving] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [showRegForm, setShowRegForm] = useState(false);
  // 最近一次从 FluffyChat 收到的登录凭证（供“立即重新绑定”手动触发）
  const lastCredsRef = useRef<{ userId: string; homeserverUrl: string } | null>(null);
  const [binding, setBinding] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);
  // bind HTTP 成功但部分步骤失败（Space 创建/补邀、虚拟用户注册等，server 端设计为
  // 非阻断）——这里透出，避免"已绑定但 IM 里什么都看不到"的静默故障。
  const [bindWarning, setBindWarning] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await jarvisFetch('/api/bridge/matrix/status', { throwOnHttpError: false });
      if (res.ok) setMxStatus(await res.json());
    } catch {
      // 静默：server 未就绪时频繁失败
    }
  }, []);

  // 同步 FluffyChat Flutter shared_preferences 原生识别的 'light' 与 'dark'
  const syncFlutterThemeStorage = (isDark: boolean) => {
    try {
      const mode = isDark ? 'dark' : 'light';

      // FluffyChat Dart 逻辑: ThemeMode.values.singleWhereOrNull((v) => v.name == rawThemeMode)
      // 必须精准写入 'light' 或 'dark'，Dart 的 value.name 才能准确匹配！
      localStorage.setItem('flutter.theme_mode', mode);
      localStorage.setItem('theme_mode', mode);
      localStorage.setItem('flutter.theme', mode);
    } catch {
      // ignore
    }
  };

  // 向同源 iframe 注入主应用的主题与背景色，实现实时跟随
  const applyBgToIframe = (info: { theme: string; isDark: boolean }) => {
    try {
      const iframeWin = iframeRef.current?.contentWindow;
      const doc = iframeRef.current?.contentDocument;
      if (!doc || !doc.documentElement) return;

      // 1. 同步设置 iframe 内 html 的 data-theme 属性
      doc.documentElement.setAttribute('data-theme', info.theme);

      // 2. 挂载主项目的 themeSheet 样式表，继承原生 CSS 变量
      const mainThemeSheet = document.getElementById('themeSheet') as HTMLLinkElement | null;
      let sheetLink = doc.getElementById('parent-theme-sheet') as HTMLLinkElement | null;
      if (mainThemeSheet && mainThemeSheet.href) {
        if (!sheetLink) {
          sheetLink = doc.createElement('link');
          sheetLink.id = 'parent-theme-sheet';
          sheetLink.rel = 'stylesheet';
          doc.head.appendChild(sheetLink);
        }
        sheetLink.href = mainThemeSheet.href;
      }

      // 3. 复制主应用上现有的主题 Style 标签
      const parentStyles = document.querySelectorAll('style[id*="theme"], style[id*="Theme"]');
      parentStyles.forEach(parentStyle => {
        let targetStyle = doc.getElementById('iframe-' + parentStyle.id);
        if (!targetStyle) {
          targetStyle = doc.createElement('style');
          targetStyle.id = 'iframe-' + parentStyle.id;
          doc.head.appendChild(targetStyle);
        }
        targetStyle.textContent = parentStyle.textContent;
      });

      // 4. 继承底色变量，彻底隐藏底部 Tab 栏，清除误杀容器的选择器
      let styleEl = doc.getElementById('parent-theme-style');
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.id = 'parent-theme-style';
        doc.head.appendChild(styleEl);
      }

      styleEl.textContent = `
        html, body, flt-glass-pane, flt-scene-host {
          background-color: var(--bg, transparent) !important;
          filter: none !important;
        }
        * {
          filter: none !important;
        }
        /* 隐藏底部导航栏 */
        [role="tablist"],
        flt-bottom-navigation-bar,
        flt-navigation-bar,
        .bottom-navigation-bar,
        .navigation-bar,
        .bottom-nav-bar,
        .bottom-nav,
        nav.bottom,
        nav.bottom-nav,
        .mobile-bottom-tabs,
        .tab-bar,
        .bottom-tabs,
        div[class*="bottom-nav"],
        div[class*="navigation-bar"],
        div[class*="tab-bar"],
        div[class*="bottom-tab"] {
          display: none !important;
          height: 0 !important;
          max-height: 0 !important;
          min-height: 0 !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
      `;

      // 5. 向 iframe 派发 StorageEvent 与 themeChange 事件，驱动 Flutter 内部重新加载 ThemeMode
      if (doc.documentElement) {
        try {
          doc.documentElement.dispatchEvent(new Event('themeChange'));
        } catch {
          // ignore
        }
      }
      if (iframeWin) {
        try {
          const mode = info.isDark ? 'dark' : 'light';
          iframeWin.dispatchEvent(new StorageEvent('storage', {
            key: 'flutter.theme_mode',
            newValue: mode,
            url: iframeWin.location.href,
          }));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  };

  // 监听根节点 data-theme 属性变化（在设置-界面切换主题时实时捕获）
  useEffect(() => {
    const updateTheme = () => {
      const info = getThemeInfo();
      syncFlutterThemeStorage(info.isDark);
      setThemeInfo(info);
      applyBgToIframe(info);
    };

    updateTheme();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          updateTheme();
          break;
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const host = window.location.hostname || '127.0.0.1';
  const port = serverPort || (window.location.port && window.location.port !== '5173' ? window.location.port : '44848');

  // 触发一次绑定（登录后自动 / 手动“立即重新绑定”共用）。
  const doBind = useCallback(async (userId: string, homeserverUrl: string, opts?: { force?: boolean }) => {
    if (!userId || !homeserverUrl) return;
    if (!opts?.force && lastCredsRef.current?.userId === userId) {
      // 同一用户已触发过自动绑定：除非 force，否则跳过，避免登录状态抖动重复注册
      return;
    }
    lastCredsRef.current = { userId, homeserverUrl };
    setBinding(true);
    setBindError(null);
    setBindWarning(null);
    try {
      const res = await jarvisFetch('/api/bridge/matrix/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imUserId: userId, homeserverUrl }),
        throwOnHttpError: false,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        const msg = body?.error || body?.detail || `${res.status} ${res.statusText}`;
        setBindError(typeof msg === 'string' && msg ? msg : '绑定失败');
        setBindWarning(null);
      } else {
        setBindError(null);
        // 收集非阻断性失败并透出：Space 创建/补邀、虚拟用户注册、agent 配置保存等
        const warnings: string[] = [];
        if (typeof body?.space?.error === 'string' && body.space.error) warnings.push(`Space 创建失败：${body.space.error}`);
        const regErrors = Array.isArray(body?.registrationErrors) ? body.registrationErrors : [];
        for (const e of regErrors) warnings.push(`${e?.agentId || 'agent'} 配置失败：${e?.error || '未知错误'}`);
        const matched = Array.isArray(body?.matchedAgents) ? body.matchedAgents : [];
        for (const m of matched) if (m?.registrationError) warnings.push(`${m.agentId} 虚拟用户注册失败：${m.registrationError}`);
        const dmErrors = Array.isArray(body?.dmErrors) ? body.dmErrors : [];
        for (const e of dmErrors) warnings.push(e);
        setBindWarning(warnings.length ? warnings.join('；') : null);
      }
    } catch (err: any) {
      setBindError(err?.message || String(err));
    } finally {
      setBinding(false);
      refreshStatus();
    }
  }, [refreshStatus]);

  // 新建 Agent 自动补绑：轮询 status 发现 unboundAgents（还没有 matrix 配置的 agent）
  // 且用户已登录过 FluffyChat（有凭证）时，自动重新 bind 一次（bind 幂等），
  // 让新建的 Agent 几秒内自动出现在 IM，无需手动操作。
  const lastAutoRebindAtRef = useRef(0);
  useEffect(() => {
    const unbound = mxStatus?.unboundAgents;
    if (!Array.isArray(unbound) || unbound.length === 0) return;
    if (binding) return;
    const creds = lastCredsRef.current;
    if (!creds?.userId || !creds?.homeserverUrl) return;
    const now = Date.now();
    if (now - lastAutoRebindAtRef.current < 30_000) return;
    lastAutoRebindAtRef.current = now;
    doBind(creds.userId, creds.homeserverUrl, { force: true });
  }, [mxStatus, binding, doBind]);

  // P3：监听 FluffyChat（/im iframe）登录成功后的 matrix-credentials postMessage，
  // 自动调 POST /api/bridge/matrix/bind 完成本节点 AppService 绑定（方案 §③3.1）。
  // Dart 侧（im/lib/main.dart）发送的是 jsonEncode 后的字符串，这里兼容字符串与对象两种形态。
  useEffect(() => {
    const imOrigin = `http://${host}:${port}`;
    const handler = async (e: MessageEvent) => {
      // 严格校验来源：只接受 /im iframe（http://127.0.0.1:{port}）的消息（方案 §9.4）
      if (e.origin !== imOrigin) return;
      let data: unknown = e.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const creds = data as { type?: string; userId?: string; homeserverUrl?: string } | null;
      if (creds?.type !== 'matrix-credentials') return;
      const userId = typeof creds.userId === 'string' ? creds.userId : '';
      const homeserverUrl = typeof creds.homeserverUrl === 'string' ? creds.homeserverUrl : '';
      await doBind(userId, homeserverUrl);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [host, port, doBind]);

  // 轮询绑定状态（3s）+ 首次加载 registrar 配置回填表单
  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 3000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await jarvisFetch('/api/bridge/matrix/registrar-config', { throwOnHttpError: false });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        if (typeof body.registrarUrl === 'string') setRegUrl(body.registrarUrl);
        // token 不回显；已配置时给个占位提示
        if (body.hasToken) setRegToken('••••••••');
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveRegistrar = useCallback(async () => {
    setRegSaving(true);
    setRegError(null);
    try {
      // 占位提示不作为真实 token 提交
      const token = regToken === '••••••••' ? '' : regToken;
      const res = await jarvisFetch('/api/bridge/matrix/registrar-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrarUrl: regUrl, registrarToken: token }),
        throwOnHttpError: false,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        setRegError(body?.error || `${res.status} ${res.statusText}`);
      } else {
        setRegToken('••••••••');
        setShowRegForm(false);
        refreshStatus();
      }
    } catch (err: any) {
      setRegError(err?.message || String(err));
    } finally {
      setRegSaving(false);
    }
  }, [regUrl, regToken, refreshStatus]);

  const iframeSrc = `http://${host}:${port}/im/?theme=${encodeURIComponent(themeInfo.theme)}&dark=${themeInfo.isDark ? '1' : '0'}`;

  const handleIframeLoad = () => {
    setLoaded(true);
    applyBgToIframe(themeInfo);
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
        position: 'relative',
        transition: 'background-color 0.2s ease',
      }}
    >
      {/* Matrix 绑定状态横幅：让“登录后看不到绑定迹象”的故障可见 */}
      {(() => {
        const registrarOk = !!mxStatus?.registrarConfigured;
        const bound = !!mxStatus?.bound;
        const agents = (mxStatus?.agents && typeof mxStatus.agents === 'object') ? mxStatus.agents : {};
        const enabledAgents = Object.keys(agents).filter(id => agents[id]?.enabled);
        const owner = enabledAgents.length ? agents[enabledAgents[0]]?.owner : null;
        const bannerBg = bound ? 'rgba(76,175,80,0.14)' : registrarOk ? 'rgba(255,193,7,0.16)' : 'rgba(244,67,54,0.14)';
        const bannerFg = bound ? '#4caf50' : registrarOk ? '#ffa726' : '#f44336';
        return (
          <div style={{ padding: '6px 10px', fontSize: '12px', lineHeight: '1.5', background: bannerBg, color: bannerFg, borderBottom: '1px solid var(--border, rgba(128,128,128,0.2))', flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span>
                {!registrarOk
                  ? 'as-registrar 未配置：无法注册 AppService'
                  : bound
                    ? `已绑定${owner ? ` ${owner}` : ''} · ${enabledAgents.length} 个 Agent`
                    : binding ? '正在绑定设备 Agent…' : 'IM 登录后将自动绑定；尚未绑定设备 Agent'}
              </span>
              {!registrarOk && (
                <button onClick={() => setShowRegForm(v => !v)} style={miniBtnStyle}>
                  {showRegForm ? '收起' : '配置 as-registrar'}
                </button>
              )}
              {registrarOk && !bound && lastCredsRef.current && (
                <button
                  onClick={() => doBind(lastCredsRef.current!.userId, lastCredsRef.current!.homeserverUrl, { force: true })}
                  disabled={binding}
                  style={miniBtnStyle}
                >
                  立即重新绑定
                </button>
              )}
              {registrarOk && bound && (
                <button onClick={refreshStatus} style={miniBtnStyle}>刷新</button>
              )}
            </div>
            {bindError && (
              <div style={{ color: '#f44336' }}>绑定失败：{bindError}</div>
            )}
            {bindWarning && (
              <div style={{ color: '#ffa726' }}>部分异常：{bindWarning}</div>
            )}
            {showRegForm && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '90px' }}>Registrar URL</span>
                  <input value={regUrl} onChange={e => setRegUrl(e.target.value)} placeholder="https://bitjarvis.chat/_jarvis/…" style={inputStyle} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '90px' }}>Registrar Token</span>
                  <input value={regToken} onChange={e => setRegToken(e.target.value)} onFocus={() => { if (regToken === '••••••••') setRegToken(''); }} placeholder="AS_REGISTRAR_TOKEN" style={inputStyle} />
                </label>
                {regError && <div style={{ color: '#f44336' }}>{regError}</div>}
                <div>
                  <button onClick={saveRegistrar} disabled={regSaving} style={miniBtnStyle}>{regSaving ? '保存中…' : '保存'}</button>
                  <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>保存后立即生效，无需重启</span>
                </div>
              </div>
            )}
          </div>
        );
      })()}
      {!loaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--bg)',
            color: 'var(--text-muted)',
            fontSize: '13px',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        >
          加载 IM 界面...
        </div>
      )}
      <iframe
        key={themeInfo.isDark ? 'dark' : 'light'}
        ref={iframeRef}
        src={iframeSrc}
        title="FluffyChat IM"
        onLoad={handleIframeLoad}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          backgroundColor: 'transparent',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.2s ease-out',
          filter: 'none',
        }}
      />
    </div>
  );
});
