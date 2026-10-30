/**
 * 浏览器 URL 白名单 —— "Jarvis 允许把浏览器驱动到哪些 URL" 的唯一实现。
 *
 * 孪生文件约定：本 .cjs 是实现，shared/browser-url-policy.ts 是它的 typed
 * re-export 外壳（写法同 shared/quick-chat-preferences.{cjs,ts}），因此两者
 * 结构上不可能漂移。
 *
 * 为什么放在 shared/：内嵌浏览器（Electron WebContentsView）与外部浏览器
 * （CDP 驱动用户真实的 Chrome/Edge 默认 profile）必须应用*同一份*白名单。
 * 两份拷贝迟早分叉，而分叉点就是一个安全漏洞。
 *
 * 行为契约：isAllowedBrowserUrl 与原 desktop/main.cjs 的本地实现逐字一致
 * （仅允许 http/https，解析失败即拒绝）。提升过程中刻意没有新增任何限制，
 * 以免悄悄改变内嵌浏览器既有行为。
 */

/** 校验浏览器 URL：仅允许 http/https */
function isAllowedBrowserUrl(url) {
  try {
    const p = new URL(url);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch { return false; }
}

/**
 * 日志/诊断用的 URL 脱敏：只保留 scheme://host/path，丢弃 query 与 hash。
 *
 * 真实浏览器 URL 会携带会话标识（实测形如 ?sid=...），DevTools WebSocket
 * 端点末尾还带一个即等同凭证的 UUID —— 两者都不允许进日志或诊断信息。
 */
function redactBrowserUrl(url, maxLength = 200) {
  if (url == null) return "";
  const raw = typeof url === "string" ? url : String(url);
  if (!raw) return "";

  let out = raw;
  try {
    const p = new URL(raw);
    // 无 host 的 scheme（about:blank、file:/...）不能拼成 scheme://host
    out = p.host ? `${p.protocol}//${p.host}${p.pathname}` : `${p.protocol}${p.pathname}`;
  } catch {
    // 非 URL 文本：只做保守裁剪，绝不放行 query 里的东西
    out = raw
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/?#\s]*@/gi, "$1[credentials]@")
      .split("#")[0]
      .split("?")[0];
  }

  out = out.replace(/\/devtools\/browser\/[^/?#\s]+/gi, "/devtools/browser/[redacted]");

  const limit = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : 200;
  return out.length > limit ? `${out.slice(0, limit)}…` : out;
}

module.exports = {
  isAllowedBrowserUrl,
  redactBrowserUrl,
};