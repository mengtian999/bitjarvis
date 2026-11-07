"use strict";

/**
 * electron-net-fetch-once.cjs — Chromium 网络栈传输适配器
 *
 * 桌面壳里的两处 GitHub 网络请求（列车 OTA 传输、更新历史抓取）原本分别
 * 落在 Node 的 `https.request` 与 undici `fetch` 上，两者都无视 Windows
 * 系统代理——而国内用户恰恰依赖系统代理才够得着 github.com / api.github.com
 * （直连被墙：实测 100% 超时/连接重置，走代理亚秒返回）。结果就是
 * "检查更新失败"与更新历史永远退到包内兜底。
 *
 * 本模块把这两处传输切到 Electron `net`（Chromium 网络栈）：自动跟随系统
 * 代理与 PAC，无需任何用户配置。对外提供两个加载函数：
 *
 *   - `loadElectronNetFetchOnce()` — ota-core 的 `fetchOnce` 契约实现
 *     （见 shared/artifact-core/ota-core.cjs 的 realFetchOnce：
 *     `(url, {headers, timeoutMs}) -> {statusCode, headers, bodyStream, finalUrl}`，
 *     交回的是重定向后的终态响应；逐跳 https-only 与跳数上限在 `redirect`
 *     事件里承接，语义对齐 ota-core 的 fetchWithRedirects）。
 *   - `loadElectronNetFetch()` — WHATWG-shaped `fetch`（透传 `net.fetch`，
 *     保留 `{headers, signal}` 与 `ok/status/text()`），供
 *     update-digest-history.cjs 的 `fetchImpl` 注入点使用。
 *
 * 两个加载函数在 Electron 不可用（单元测试、纯 Node 运行时）时都返回
 * `null`，调用方据此落回原传输。`net` 的解析与调用全部惰性发生在请求
 * 时刻（app ready 之后），绝不阻塞 main.cjs 的模块加载。
 */

const { Readable } = require("stream");

function requireElectronNet() {
  try {
    const electron = require("electron");
    const net = electron && (electron.net || (electron.default && electron.default.net));
    if (net && typeof net.request === "function" && typeof net.fetch === "function") return net;
    return null;
  } catch {
    return null;
  }
}

/**
 * Chromium 响应头 → Node 风格：键统一小写，数组值折叠成逗号串。
 * fetchWithRedirects 读 `location`、fetchBuffer 读 `etag`，都假定
 * Node https 的头形状（小写键 + 标量/字符串数组）。
 */
function normalizeHeaders(chromiumHeaders) {
  const headers = {};
  if (!chromiumHeaders || typeof chromiumHeaders !== "object") return headers;
  for (const [key, value] of Object.entries(chromiumHeaders)) {
    headers[String(key).toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return headers;
}

/**
 * ota-core `fetchOnce` 契约的 Electron 实现，三层行为与原传输对齐：
 *
 * 1. 重定向：逐跳跟随并逐跳执行 https-only 与跳数上限——与
 *    fetchWithRedirects 语义一致（https 重定向到 http 是拒绝，不是静默
 *    降级）。Electron 的 `redirect: "manual"` 下 3xx 不会作为 response
 *    交付，而是先发 `redirect` 事件、等 `followRedirect()`：这正是要的
 *    手动逐跳控制点（ota-core 自己的重定向循环在这里永远看不到 3xx——
 *    适配器交回的已是终态响应；上限取 Chromium 自身的 20）。
 * 2. 超时：响应头到达前整体计时，超时 abort 并 reject（对齐 realFetchOnce
 *    的 socket timeout 语义——GitHub 卡在握手/响应头是墙内直连最常见
 *    的形态）。
 * 3. 响应体：上层（fetchBuffer / downloadToFile）各有停顿守卫，但
 *    Chromium 栈没有 socket idle 事件兜底，这里对 bodyStream 加一个
 *    "每收到数据就重置"的空闲看门狗，超时即销毁流，让下游 promise 以
 *    错误收场，而不是永久悬挂。
 */
const REDIRECT_HOP_LIMIT = 20;

function createElectronNetFetchOnce(net) {
  return function electronNetFetchOnce(url, { headers = {}, timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      let request;
      let settled = false;
      let headerTimer = null;
      let idleTimer = null;
      let redirectHops = 0;

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        if (headerTimer) clearTimeout(headerTimer);
        if (idleTimer) clearInterval(idleTimer);
        fn(value);
      };
      const rejectOnce = (err) => settle(reject, err);

      try {
        request = net.request({ url, method: "GET", redirect: "manual" });
      } catch (err) {
        rejectOnce(err);
        return;
      }

      headerTimer = setTimeout(() => {
        // 先以我们的超时文案定局，再 abort——abort 引发的 'error' 事件
        // 会被 rejectOnce 静默吞掉，不让 "Aborted" 抢走错误语义。
        rejectOnce(new Error(`electron-net-fetch-once: request timed out for ${url}`));
        try { request.abort(); } catch { /* 已结束的请求 abort 无害 */ }
      }, timeoutMs);

      request.on("redirect", (...args) => {
        // Electron 各版本的事件签名在 (method, redirectURL) 与
        // (statusCode, method, redirectURL, responseHeaders) 之间摆动——
        // 不盯具体位置，在参数里找那个能解析成 http(s) 的 URL 字符串。
        const redirectURL = args.map(String).reverse().find((value) => {
          try {
            const parsed = new URL(value);
            return parsed.protocol === "https:" || parsed.protocol === "http:";
          } catch {
            return false;
          }
        });
        redirectHops += 1;
        let next;
        try {
          next = new URL(redirectURL);
        } catch {
          rejectOnce(new Error(`electron-net-fetch-once: invalid redirect target ${redirectURL}`));
          try { request.abort(); } catch { /* 已定局，abort 仅防悬挂 */ }
          return;
        }
        if (next.protocol !== "https:") {
          rejectOnce(new Error(`electron-net-fetch-once: refusing non-https redirect ${redirectURL}`));
          try { request.abort(); } catch { /* 已定局，abort 仅防悬挂 */ }
          return;
        }
        if (redirectHops > REDIRECT_HOP_LIMIT) {
          rejectOnce(new Error(`electron-net-fetch-once: too many redirects (> ${REDIRECT_HOP_LIMIT}) for ${url}`));
          try { request.abort(); } catch { /* 已定局，abort 仅防悬挂 */ }
          return;
        }
        request.followRedirect();
      });

      request.on("error", (err) => {
        rejectOnce(err instanceof Error ? err : new Error(String(err)));
      });

      request.on("response", (response) => {
        const bodyStream = (response && typeof response.pipe === "function")
          ? response
          : Readable.fromWeb(response);
        const statusCode = response.statusCode;
        const responseHeaders = normalizeHeaders(response.headers);

        // 空闲看门狗：bodyStream 每来一块数据就重置；连续 timeoutMs 无数据
        // 即判定卡死，销毁流让下游（fetchBuffer/downloadToFile）收到 error。
        idleTimer = setInterval(() => {
          if (typeof bodyStream.destroy === "function") {
            bodyStream.destroy(new Error(`electron-net-fetch-once: response body idle for ${timeoutMs}ms (${url})`));
          }
          try { request.abort(); } catch { /* 流已死时 abort 无害 */ }
        }, timeoutMs);
        if (typeof idleTimer.unref === "function") idleTimer.unref();

        bodyStream.on("data", () => {
          idleTimer.refresh();
        });
        bodyStream.on("end", () => {
          if (idleTimer) clearInterval(idleTimer);
        });
        bodyStream.on("close", () => {
          if (idleTimer) clearInterval(idleTimer);
        });
        bodyStream.on("error", () => {
          if (idleTimer) clearInterval(idleTimer);
        });

        settle(resolve, {
          statusCode,
          headers: responseHeaders,
          bodyStream,
          finalUrl: url,
        });
      });

      for (const [key, value] of Object.entries(headers)) {
        try { request.setHeader(key, value); } catch { /* 保留其余可设置的头 */ }
      }
      request.end();
    });
  };
}

let cachedFetchOnce;
let cachedFetch;

/** ota-core `fetchOnce` 契约实现；Electron 不可用时返回 null。 */
function loadElectronNetFetchOnce() {
  if (cachedFetchOnce !== undefined) return cachedFetchOnce;
  const net = requireElectronNet();
  cachedFetchOnce = net ? createElectronNetFetchOnce(net) : null;
  return cachedFetchOnce;
}

/**
 * WHATWG-shaped fetch（透传 net.fetch，自动跟随重定向），供
 * update-digest-history 的 fetchImpl 注入点使用；Electron 不可用时返回
 * null。net.fetch 的调用推迟到请求时刻——main.cjs 在模块加载期创建
 * loader，那时 app 尚未 ready，提前触碰 net.fetch 会直接抛错。
 */
function loadElectronNetFetch() {
  if (cachedFetch !== undefined) return cachedFetch;
  const net = requireElectronNet();
  cachedFetch = net ? net.fetch.bind(net) : null;
  return cachedFetch;
}

module.exports = {
  loadElectronNetFetchOnce,
  loadElectronNetFetch,
};
