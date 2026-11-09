import { createRoot } from 'react-dom/client';
import App from './react/App';
import { bootstrapI18n } from './react/i18n-boot';

function markLaunch(event: string, details?: unknown) {
  if (details === undefined) {
    console.info(`[jarvis-launch] ${event}`);
  } else {
    console.info(`[jarvis-launch] ${event}`, details);
  }
}

markLaunch('renderer-entry');

window.addEventListener('securitypolicyviolation', (event) => {
  markLaunch('securitypolicyviolation', JSON.stringify({
    blockedURI: event.blockedURI,
    violatedDirective: event.violatedDirective,
    effectiveDirective: event.effectiveDirective,
    originalPolicy: event.originalPolicy,
    disposition: event.disposition,
    sourceFile: event.sourceFile,
    lineNumber: event.lineNumber,
    columnNumber: event.columnNumber,
  }));
});

// 语言包预加载与 React 模块解析并行启动（内部有 1.2s 上限，绝不阻塞首屏）。
const i18nReady = bootstrapI18n();

async function mount(): Promise<void> {
  const el = document.getElementById('react-root');
  if (!el) {
    markLaunch('react-root-missing');
    return;
  }
  // 首屏先等语言包落地：initApp() 里的 server 等待最长 120s，那之前语言包若还没到，
  // 30s 兜底显示的窗口会是满屏 `sidebar.bridgeShort` 这样的原始 key。
  markLaunch('i18n-ready', await i18nReady);
  markLaunch('root-mount-start');
  createRoot(el).render(<App />);
  markLaunch('root-mounted');
}

void mount();
