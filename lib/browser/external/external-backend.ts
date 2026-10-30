/**
 * 外部浏览器后端 —— 把 BrowserManager 的命令协议（launch/navigate/snapshot/click/…）
 * 实现到用户真实登录态的 Chrome/Edge 上。
 *
 * 与内嵌后端的根本差异，也是本模块的三条铁律：
 *  1. **标签页有所有权之分**。owned=true 的只有我们 Target.createTarget 开出来的
 *     标签；用户自己开的标签只可 attach/detach，suspend / 闲置回收 / LRU 淘汰
 *     绝不允许 closeTarget —— 那是用户正在用的页面。
 *  2. **绝不碰用户数据**。clearBrowserCookiesAndSiteData 在本后端被拒绝
 *     （manager 侧拦截），这里也没有任何读写 Cookies/Login Data 的路径。
 *  3. **断线是常态**。浏览器重启后端口漂移、targetId 全部失效；连接前必须重新
 *     discovery，attach 失败按"标签已被用户关掉"剪枝，而不是报错。
 *
 * 连接复用：一条浏览器级 CDP 连接（CdpClient）承载所有 session 的所有标签会话。
 */
import {
  BrowserExternalError,
  CdpClient,
} from "./cdp-client.ts";
import {
  discoverCdpEndpoint,
  EXTERNAL_BROWSER_CHANNELS,
  type DiscoveredCdpEndpoint,
  type ExternalBrowserChannel,
} from "./cdp-discovery.ts";
import { isAllowedBrowserUrl, redactBrowserUrl } from "../../../shared/browser-url-policy.ts";
import {
  clickExpression,
  hasSelectorExpression,
  hasTextExpression,
  locationExpression,
  pressKeyExpression,
  scrollExpression,
  selectExpression,
  snapshotExpression,
  typeExpression,
} from "./page-script.ts";

const NAVIGATE_LOAD_TIMEOUT_MS = 15_000;
const WAIT_DEFAULT_TIMEOUT_MS = 15_000;

export interface ExternalTabRecord {
  targetId: string;
  sessionId: string | null; // detach 后为 null，下次用时重新 attach
  owned: boolean;
  url: string | null;
  title: string | null;
}

export interface ExternalSessionRecord {
  sessionPath: string;
  tabs: Map<string, ExternalTabRecord>; // targetId → record
  activeTargetId: string | null;
}

export interface ExternalBackendDeps {
  /** 发现端点（默认：读真实 profile 的 DevToolsActivePort）。测试注入假发现。 */
  discover?: (channel: ExternalBrowserChannel) => DiscoveredCdpEndpoint | null;
  /** 构造 CDP 客户端。测试注入假客户端。 */
  createClient?: (options: { wsUrl: string; onFatal: (err: BrowserExternalError) => void }) => CdpClient;
  /** 连接级致命错误（浏览器断开）：manager 用它把相关 session 标为不可用。 */
  onFatal?: (err: BrowserExternalError) => void;
  /** 发现顺序，默认 chrome 优先。 */
  channels?: ExternalBrowserChannel[];
}

export class ExternalBrowserBackend {
  declare _sessions: Map<string, ExternalSessionRecord>;
  declare _client: CdpClient | null;
  declare _connecting: Promise<CdpClient> | null;
  declare _discover: (channel: ExternalBrowserChannel) => DiscoveredCdpEndpoint | null;
  declare _createClient: (options: { wsUrl: string; onFatal: (err: BrowserExternalError) => void }) => CdpClient;
  declare _onFatal: ((err: BrowserExternalError) => void) | null;
  declare _channels: ExternalBrowserChannel[];

  constructor(options: ExternalBackendDeps = {}) {
    this._sessions = new Map();
    this._client = null;
    this._connecting = null;
    this._discover = options.discover
      ?? ((channel) => discoverCdpEndpoint({ channel }));
    this._createClient = options.createClient
      ?? ((opts) => new CdpClient({ wsUrl: opts.wsUrl, onFatal: opts.onFatal }));
    this._onFatal = options.onFatal ?? null;
    this._channels = options.channels ?? [...EXTERNAL_BROWSER_CHANNELS];
  }

  /** 同步探测当前是否存在可连接端点（readiness 检查用，不建立连接）。 */
  probe(): DiscoveredCdpEndpoint | null {
    for (const channel of this._channels) {
      const endpoint = this._discover(channel);
      if (endpoint) return endpoint;
    }
    return null;
  }

  /** 按通道分别探测（UI "检查连接" 用，显示 Chrome / Edge 各自状态）。 */
  probeChannels(): Array<{ channel: ExternalBrowserChannel; found: boolean }> {
    return this._channels.map((channel) => ({
      channel,
      found: !!this._discover(channel),
    }));
  }


  /**
   * 命令入口：与内嵌宿主 handleBrowserCommand 同一套命令名与返回形状。
   * 未知命令一律 UNSUPPORTED —— 宁可明确失败，也不静默吞掉 agent 的动作。
   */
  async handle(cmd: string, params: any = {}): Promise<any> {
    switch (cmd) {
      // ── 降级表：外部浏览器没有内嵌 viewer，这些命令无意义但不报错 ──
      case "destroyView":
      case "viewerShowSession":
        return {};
      case "launch": return this._launch(params);
      case "resume": return this._resume(params);
      case "suspend": return this._suspend(params);
      case "close": return this._closeSession(params);
      case "newTab": return this._newTab(params);
      case "switchTab": return this._switchTab(params);
      case "closeTab": return this._closeTab(params);
      case "navigate": return this._navigate(params);
      case "snapshot": return this._snapshot(params);
      case "screenshot": return this._screenshot(params);
      case "show": return this._show(params);
      case "click": return this._interact(params, () => clickExpression(params.ref));
      case "type": return this._interact(params, () => typeExpression(params.ref, params.text, params.pressEnter === true));
      case "scroll": return this._interact(params, () => scrollExpression(params.direction, params.amount));
      case "select": return this._interact(params, () => selectExpression(params.ref, params.value));
      case "pressKey": return this._interact(params, () => pressKeyExpression(params.key));
      case "evaluate": return this._evaluate(params);
      case "wait": return this._wait(params);
      default:
        throw new BrowserExternalError(
          "BROWSER_EXTERNAL_UNSUPPORTED",
          `The external browser backend does not implement "${cmd}"`,
        );
    }
  }

  // ── 连接管理 ──────────────────────────────────────────────

  /**
   * 确保浏览器级连接可用。每次建立前重新 discovery（端口漂移是常态），
   * 按 channels 顺序试错；全部失败时抛出**第一个**真实错误（通常是用户最
   * 需要看到的那一个，例如"还没在确认框点允许"）。
   */
  async _ensureClient(): Promise<CdpClient> {
    if (this._client?.connected) return this._client;
    if (this._connecting) return this._connecting;

    const attempt = (async (): Promise<CdpClient> => {
      let firstError: any = null;
      for (const channel of this._channels) {
        const endpoint = this._discover(channel);
        if (!endpoint) continue;
        const client = this._createClient({
          wsUrl: endpoint.wsUrl,
          onFatal: (err) => this._handleFatal(err),
        });
        try {
          await client.connect();
          this._client = client;
          this._bindClientEvents(client);
          return client;
        } catch (err) {
          if (!firstError) firstError = err;
          try { await client.close(); } catch { /* 没连上，无需补偿 */ }
        }
      }
      if (firstError) throw firstError;
      throw new BrowserExternalError(
        "BROWSER_EXTERNAL_NOT_RUNNING",
        "No Chrome or Edge with remote debugging enabled was found. "
        + "Open chrome://inspect/#remote-debugging (or edge://inspect) in your browser, "
        + "enable it, then try again.",
      );
    })();

    this._connecting = attempt;
    try {
      return await attempt;
    } finally {
      this._connecting = null;
    }
  }

  /** 跟踪 target 生灭：用户自己关掉标签时，本地记录同步剪枝。 */
  _bindClientEvents(client: CdpClient) {
    client.onEvent((event) => {
      if (event.method === "Target.targetDestroyed") {
        const targetId = event.params?.targetId;
        if (typeof targetId !== "string") return;
        for (const rec of this._sessions.values()) {
          if (rec.tabs.delete(targetId) && rec.activeTargetId === targetId) {
            rec.activeTargetId = rec.tabs.keys().next().value ?? null;
          }
        }
        return;
      }
      if (event.method === "Target.targetInfoChanged") {
        const info = event.params?.targetInfo;
        if (!info || typeof info.targetId !== "string") return;
        for (const rec of this._sessions.values()) {
          const tab = rec.tabs.get(info.targetId);
          if (tab) {
            if (typeof info.url === "string") tab.url = info.url;
            if (typeof info.title === "string") tab.title = info.title;
          }
        }
      }
    });
  }

  /**
   * 连接级致命错误：所有 sessionId 立即作废（socket 死了它们全死了），
   * 清掉客户端引用让下一次命令重新 discovery + 连接，并通知 manager。
   */
  _handleFatal(err: BrowserExternalError) {
    this._client = null;
    for (const rec of this._sessions.values()) {
      for (const tab of rec.tabs.values()) tab.sessionId = null;
    }
    try { this._onFatal?.(err); } catch { /* 上层回调不该影响清理 */ }
  }

  // ── session / tab 解析 ────────────────────────────────────

  _sessionRecord(sessionPath: string): ExternalSessionRecord {
    if (!sessionPath) {
      throw new BrowserExternalError("BROWSER_EXTERNAL_UNSUPPORTED", "external browser command requires sessionPath");
    }
    let rec = this._sessions.get(sessionPath);
    if (!rec) {
      rec = { sessionPath, tabs: new Map(), activeTargetId: null };
      this._sessions.set(sessionPath, rec);
    }
    return rec;
  }

  /** attach 并开启 Page 域（loadEventFired 等待需要）；已 attach 则直接返回。 */
  async _attachTab(client: CdpClient, tab: ExternalTabRecord): Promise<string> {
    if (tab.sessionId && client.connected) return tab.sessionId;
    tab.sessionId = await client.attachToTarget(tab.targetId);
    await client.send("Page.enable", {}, { sessionId: tab.sessionId });
    return tab.sessionId;
  }

  /**
   * 解析目标标签：显式 tabId → active → （没有可用标签时）新开一个 owned 空白页。
   * attach 失败 = 用户已把该标签关掉：剪枝后落到下一个。
   */
  async _resolveTab(
    client: CdpClient,
    rec: ExternalSessionRecord,
    tabId: string | null,
    { createIfMissing = true }: { createIfMissing?: boolean } = {},
  ): Promise<ExternalTabRecord> {
    const candidates: ExternalTabRecord[] = [];
    if (tabId) {
      const tab = rec.tabs.get(tabId);
      if (!tab) throw new Error(`No such tab in this session: ${tabId}`);
      candidates.push(tab);
    } else if (rec.activeTargetId && rec.tabs.has(rec.activeTargetId)) {
      candidates.push(rec.tabs.get(rec.activeTargetId)!);
    }
    if (!tabId) {
      for (const tab of rec.tabs.values()) {
        if (!candidates.includes(tab)) candidates.push(tab);
      }
    }

    for (const tab of candidates) {
      try {
        await this._attachTab(client, tab);
        rec.activeTargetId = tab.targetId;
        return tab;
      } catch {
        rec.tabs.delete(tab.targetId); // 已被用户关掉，剪枝
      }
    }

    if (tabId) throw new Error(`Tab is no longer open in the external browser: ${tabId}`);
    if (rec.tabs.size > 0) {
      // 还有标签但都 attach 失败（理论上已被上面剪枝清空，兜底）
      throw new BrowserExternalError(
        "BROWSER_EXTERNAL_DISCONNECTED",
        "All known tabs of this session were closed by the user or are unattainable",
      );
    }
    if (!createIfMissing) throw new Error("This session has no open tab in the external browser");
    return this._createTab(client, rec, null);
  }

  async _createTab(client: CdpClient, rec: ExternalSessionRecord, url: string | null): Promise<ExternalTabRecord> {
    const targetUrl = url && isAllowedBrowserUrl(url) ? url : "about:blank";
    const created = await client.send("Target.createTarget", { url: targetUrl });
    const targetId = created?.targetId;
    if (typeof targetId !== "string" || !targetId) {
      throw new BrowserExternalError("BROWSER_EXTERNAL_UNSUPPORTED", "Target.createTarget returned no targetId");
    }
    const tab: ExternalTabRecord = {
      targetId,
      sessionId: null,
      owned: true, // 我们开的标签才有所有权
      url: targetUrl === "about:blank" ? null : targetUrl,
      title: null,
    };
    rec.tabs.set(targetId, tab);
    rec.activeTargetId = targetId;
    await this._attachTab(client, tab);
    return tab;
  }

  // ── 求值与快照 ────────────────────────────────────────────

  /** 在标签会话里执行表达式并解析 JSON 结果；JS 异常映射为 UNSUPPORTED。 */
  async _evalJson(client: CdpClient, sessionId: string, expression: string): Promise<any> {
    const result = await client.send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      { sessionId },
    );
    if (result?.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "unknown page error";
      throw new BrowserExternalError(
        "BROWSER_EXTERNAL_UNSUPPORTED",
        `Page evaluation failed: ${redactBrowserUrl(String(detail).split("\n")[0])}`,
      );
    }
    const value = result?.result?.value;
    if (typeof value !== "string") return value ?? null;
    try { return JSON.parse(value); } catch { return value; }
  }

  /** 刷新标签的 url/title（动作后页面可能已经跳转）。 */
  async _refreshTabLocation(client: CdpClient, tab: ExternalTabRecord) {
    if (!tab.sessionId) return;
    try {
      const loc = await this._evalJson(client, tab.sessionId, locationExpression());
      if (loc && typeof loc === "object") {
        if (typeof loc.url === "string") tab.url = loc.url;
        if (typeof loc.title === "string") tab.title = loc.title;
      }
    } catch { /* 页面正在销毁等瞬态：保留旧值即可 */ }
  }

  async _snapshotOf(client: CdpClient, tab: ExternalTabRecord): Promise<{ text: string; url: string | null; title: string | null }> {
    const sessionId = await this._attachTab(client, tab);
    const snap = await this._evalJson(client, sessionId, snapshotExpression());
    if (snap && typeof snap === "object") {
      if (typeof snap.url === "string") tab.url = snap.url;
      if (typeof snap.title === "string") tab.title = snap.title;
      return { text: String(snap.text || ""), url: tab.url, title: tab.title };
    }
    return { text: "", url: tab.url, title: tab.title };
  }

  /** manager 期望的 workspace 形状：{ tabs, activeTabId, url }。 */
  _workspace(rec: ExternalSessionRecord) {
    const tabs = [...rec.tabs.values()].map((tab) => ({
      tabId: tab.targetId,
      title: tab.title || "New Tab",
      url: tab.url,
    }));
    const active = rec.activeTargetId ? rec.tabs.get(rec.activeTargetId) : null;
    return {
      tabs,
      activeTabId: active?.targetId ?? tabs[0]?.tabId ?? null,
      url: active?.url ?? tabs[0]?.url ?? null,
    };
  }



  // ── 生命周期命令 ──────────────────────────────────────────

  async _launch(params: any) {
    const rec = this._sessionRecord(params.sessionPath);
    const client = await this._ensureClient();

    if (rec.tabs.size === 0) {
      // 冷恢复：launch 可以带整组 tabs；URL 一律过白名单，不放行冷状态里的脏数据
      const coldTabs = Array.isArray(params.tabs) ? params.tabs : [];
      let created = 0;
      for (const cold of coldTabs) {
        const url = typeof cold?.url === "string" && isAllowedBrowserUrl(cold.url) ? cold.url : null;
        await this._createTab(client, rec, url);
        created++;
      }
      if (created === 0) await this._createTab(client, rec, null);
    } else {
      // 热启动/重连：重新 attach 仍在的标签，剪掉已被用户关掉的
      await this._resolveTab(client, rec, rec.activeTargetId, { createIfMissing: true });
    }
    return this._workspace(rec);
  }

  async _resume(params: any) {
    const rec = this._sessions.get(params.sessionPath);
    if (!rec || rec.tabs.size === 0) return { found: false };
    const client = await this._ensureClient();
    await this._resolveTab(client, rec, rec.activeTargetId, { createIfMissing: false });
    return { found: true, ...this._workspace(rec) };
  }

  /** 挂起 = 只 detach。绝不关标签 —— 无论 owned 与否，页面都还给用户。 */
  async _suspend(params: any) {
    const rec = this._sessions.get(params.sessionPath);
    if (!rec) return {};
    const client = this._client;
    if (client?.connected) {
      for (const tab of rec.tabs.values()) {
        if (tab.sessionId) await client.detachSession(tab.sessionId);
        tab.sessionId = null;
      }
    } else {
      for (const tab of rec.tabs.values()) tab.sessionId = null;
    }
    return {};
  }

  /** 关闭 session：owned 标签关闭（我们开的我们收），其余只 detach。共享连接保留。 */
  async _closeSession(params: any) {
    const rec = this._sessions.get(params.sessionPath);
    if (!rec) return {};
    const client = this._client;
    if (client?.connected) {
      for (const tab of rec.tabs.values()) {
        if (tab.owned) {
          try { await client.send("Target.closeTarget", { targetId: tab.targetId }, { timeoutMs: 5000 }); } catch { /* 用户可能已关 */ }
        } else if (tab.sessionId) {
          await client.detachSession(tab.sessionId);
        }
      }
    }
    this._sessions.delete(rec.sessionPath);
    return {};
  }

  // ── 标签命令 ──────────────────────────────────────────────

  async _newTab(params: any) {
    const rec = this._sessionRecord(params.sessionPath);
    const url = typeof params.url === "string" && params.url ? params.url : null;
    if (url) this._assertAllowed(url);
    const client = await this._ensureClient();
    await this._createTab(client, rec, url);
    return this._workspace(rec);
  }

  async _switchTab(params: any) {
    const rec = this._sessionRecord(params.sessionPath);
    const client = await this._ensureClient();
    const tab = await this._resolveTab(client, rec, String(params.tabId || ""), { createIfMissing: false });
    try { await client.send("Target.activateTarget", { targetId: tab.targetId }, { timeoutMs: 5000 }); } catch { /* 置前失败不致命 */ }
    await this._refreshTabLocation(client, tab);
    return this._workspace(rec);
  }

  async _closeTab(params: any) {
    const rec = this._sessionRecord(params.sessionPath);
    const tabId = String(params.tabId || "");
    const tab = rec.tabs.get(tabId);
    if (!tab) throw new Error(`No such tab in this session: ${tabId}`);
    const client = this._client;
    if (client?.connected) {
      if (tab.owned) {
        try { await client.send("Target.closeTarget", { targetId: tab.targetId }, { timeoutMs: 5000 }); } catch { /* 用户可能已关 */ }
      } else if (tab.sessionId) {
        await client.detachSession(tab.sessionId);
      }
    }
    rec.tabs.delete(tabId);
    if (rec.activeTargetId === tabId) rec.activeTargetId = rec.tabs.keys().next().value ?? null;
    // 空标签组是合法状态（manager 按活 workspace 处理）
    return this._workspace(rec);
  }


  // ── 导航与感知 ────────────────────────────────────────────

  _assertAllowed(url: string) {
    if (!isAllowedBrowserUrl(url)) {
      throw new Error(
        `Blocked by browser URL policy: ${redactBrowserUrl(url)}. `
        + "The external browser accepts the same allowlist as the embedded browser.",
      );
    }
  }

  async _navigate(params: any) {
    const url = String(params.url || "");
    this._assertAllowed(url);
    const rec = this._sessionRecord(params.sessionPath);
    const client = await this._ensureClient();
    const tab = await this._resolveTab(client, rec, typeof params.tabId === "string" && params.tabId ? params.tabId : null);
    const sessionId = tab.sessionId!;

    const loaded = this._waitForLoadEvent(client, sessionId, NAVIGATE_LOAD_TIMEOUT_MS);
    await client.send("Page.navigate", { url }, { sessionId });
    await loaded; // 超时不视为失败：慢页面上 agent 仍可根据快照继续

    await this._refreshTabLocation(client, tab);
    const snap = await this._snapshotOf(client, tab);
    return { url: snap.url || url, title: snap.title || "", snapshot: snap.text, tabId: tab.targetId };
  }

  _waitForLoadEvent(client: CdpClient, sessionId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        resolve();
      };
      const off = client.onEvent((event) => {
        if (event.sessionId === sessionId && event.method === "Page.loadEventFired") finish();
      });
      const timer = setTimeout(finish, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

  async _snapshot(params: any) {
    const rec = this._sessionRecord(params.sessionPath);
    const client = await this._ensureClient();
    const tab = await this._resolveTab(client, rec, typeof params.tabId === "string" && params.tabId ? params.tabId : null);
    const snap = await this._snapshotOf(client, tab);
    return { text: snap.text, url: snap.url, title: snap.title, tabId: tab.targetId };
  }

  async _screenshot(params: any) {
    const rec = this._sessionRecord(params.sessionPath);
    const client = await this._ensureClient();
    const tab = await this._resolveTab(client, rec, typeof params.tabId === "string" && params.tabId ? params.tabId : null);
    const result = await client.send(
      "Page.captureScreenshot",
      { format: "jpeg", quality: 60 },
      { sessionId: tab.sessionId! },
    );
    if (typeof result?.data !== "string" || !result.data) {
      throw new BrowserExternalError("BROWSER_EXTERNAL_UNSUPPORTED", "Page.captureScreenshot returned no image data");
    }
    return { base64: result.data };
  }

  /** show = 把标签带到用户浏览器前台（没有内嵌 viewer 可置前）。 */
  async _show(params: any) {
    const rec = this._sessionRecord(params.sessionPath);
    const client = await this._ensureClient();
    const tab = await this._resolveTab(client, rec, typeof params.tabId === "string" && params.tabId ? params.tabId : null);
    await client.send("Target.activateTarget", { targetId: tab.targetId }, { timeoutMs: 5000 });
    return {};
  }


  // ── 交互命令（动作后统一回新快照） ─────────────────────────

  async _interact(params: any, buildExpression: () => string) {
    const rec = this._sessionRecord(params.sessionPath);
    const client = await this._ensureClient();
    const tab = await this._resolveTab(client, rec, typeof params.tabId === "string" && params.tabId ? params.tabId : null);
    const outcome = await this._evalJson(client, tab.sessionId!, buildExpression());
    if (outcome && outcome.ok === false) {
      throw new Error(String(outcome.error || "interaction failed"));
    }
    const snap = await this._snapshotOf(client, tab);
    return { text: snap.text, url: snap.url, title: snap.title, tabId: tab.targetId };
  }

  async _evaluate(params: any) {
    const rec = this._sessionRecord(params.sessionPath);
    const client = await this._ensureClient();
    const tab = await this._resolveTab(client, rec, typeof params.tabId === "string" && params.tabId ? params.tabId : null);
    const result = await client.send(
      "Runtime.evaluate",
      { expression: String(params.expression || ""), returnByValue: true, awaitPromise: true },
      { sessionId: tab.sessionId! },
    );
    if (result?.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "unknown page error";
      throw new BrowserExternalError(
        "BROWSER_EXTERNAL_UNSUPPORTED",
        `Page evaluation failed: ${redactBrowserUrl(String(detail).split("\n")[0])}`,
      );
    }
    return { value: result?.result?.value ?? null };
  }

  async _wait(params: any) {
    const rec = this._sessionRecord(params.sessionPath);
    const client = await this._ensureClient();
    const tab = await this._resolveTab(client, rec, typeof params.tabId === "string" && params.tabId ? params.tabId : null);
    const sessionId = tab.sessionId!;
    const timeoutMs = Number.isFinite(Number(params.timeoutMs)) ? Number(params.timeoutMs) : WAIT_DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    if (Number.isFinite(Number(params.ms)) && Number(params.ms) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(Number(params.ms), timeoutMs)));
    }
    const selector = typeof params.selector === "string" && params.selector ? params.selector : null;
    const text = typeof params.text === "string" && params.text ? params.text : null;
    // 轮询到条件满足或超时；超时按"条件未出现"正常返回快照，让 agent 自己判断
    while ((selector || text) && Date.now() < deadline) {
      const probe = selector
        ? await this._evalJson(client, sessionId, hasSelectorExpression(selector))
        : await this._evalJson(client, sessionId, hasTextExpression(text));
      if (probe?.found) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const snap = await this._snapshotOf(client, tab);
    return { text: snap.text, url: snap.url, title: snap.title, tabId: tab.targetId };
  }
}
