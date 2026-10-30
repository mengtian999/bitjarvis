/**
 * 外部浏览器 CDP 客户端 —— 单条浏览器级 WebSocket 上复用多个页面会话。
 *
 * 背景（M0 实测）：用户真实 Chrome/Edge 的远程调试只暴露一条 WebSocket
 * 通道，`/json/version`、`/json/list` 都 404，所以所有能力（列标签、附加、
 * 执行脚本）都必须在这条 WS 上以 `Target.*` / `Runtime.*` 命令完成。
 *
 * 三件事必须做对：
 *  1. **会话路由**。浏览器级消息不带 `sessionId`，页面级消息带。两者共用一条
 *     连接，靠 `sessionId` 区分；attach 时一律 `flatten: true`（把子会话的消息
 *     平铺到同一条 WS 上，而不是另开一条）。
 *  2. **未授权是一种状态，不是错误**。首次连接时浏览器会弹"允许远程调试"
 *     确认框，在用户点允许之前握手既不完成也不失败。所以超时要单独区分成
 *     AWAITING_AUTH（浏览器已应答但拒绝）/ AUTH_TIMEOUT（一直没应答），
 *     不能和 CONNECT_FAILED（浏览器根本没在监听）混为一谈 —— 用户看到后
 *     要做的事完全不同。
 *  3. **错误信息与日志里不能出现真 URL**。DevTools 端点里那个 UUID 等同凭证，
 *     页面 URL 带 `?sid=...`，一律经 redactBrowserUrl 处理。
 */
import WebSocket from "ws";
import { redactBrowserUrl } from "../../../shared/browser-url-policy.ts";

export type BrowserExternalErrorCode =
  | "BROWSER_EXTERNAL_NOT_RUNNING"
  | "BROWSER_EXTERNAL_AWAITING_AUTH"
  | "BROWSER_EXTERNAL_AUTH_TIMEOUT"
  | "BROWSER_EXTERNAL_CONNECT_FAILED"
  | "BROWSER_EXTERNAL_DISCONNECTED"
  | "BROWSER_EXTERNAL_UNSUPPORTED"
  | "BROWSER_EXTERNAL_COMMAND_TIMEOUT";

export class BrowserExternalError extends Error {
  declare code: BrowserExternalErrorCode;
  declare detail: string | null;

  constructor(code: BrowserExternalErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.name = "BrowserExternalError";
    this.code = code;
    this.detail = detail;
  }
}

export function isBrowserExternalError(value: unknown): value is BrowserExternalError {
  return value instanceof BrowserExternalError;
}

const DEFAULT_AUTH_TIMEOUT_MS = 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/** 连接被拒绝类错误：浏览器没在监听 / 端点已失效。 */
const CONNECT_REFUSED_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

export interface CdpEvent {
  method: string;
  params: any;
  sessionId: string | null;
}

interface PendingCommand {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: any;
  method: string;
}

function pendingKey(id: number, sessionId: string | null): string {
  return `${sessionId || ""}|${id}`;
}

export class CdpClient {
  wsUrl: string;
  authTimeoutMs: number;
  commandTimeoutMs: number;

  _ws: any;
  _pending = new Map<string, PendingCommand>();
  _eventHandlers = new Set<(event: CdpEvent) => void>();
  _nextId = 1;
  _connected = false;
  _closed = false;
  _fatalFired = false;
  _onFatal: ((err: BrowserExternalError) => void) | null;

  constructor(options: {
    wsUrl: string;
    authTimeoutMs?: number;
    commandTimeoutMs?: number;
    onFatal?: (err: BrowserExternalError) => void;
  }) {
    this.wsUrl = options.wsUrl;
    this.authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this._onFatal = options.onFatal ?? null;
    this._ws = null;
  }

  /** 脱敏后的端点，用于日志/诊断。 */
  get safeUrl(): string {
    return redactBrowserUrl(this.wsUrl);
  }

  get connected(): boolean {
    return this._connected && this._ws?.readyState === 1;
  }

  onEvent(handler: (event: CdpEvent) => void): () => void {
    this._eventHandlers.add(handler);
    return () => this._eventHandlers.delete(handler);
  }

  onFatal(handler: (err: BrowserExternalError) => void): void {
    this._onFatal = handler;
  }

  /**
   * 建立浏览器级连接。等待握手的上限是 authTimeoutMs —— 这段时间里用户可能
   * 正在浏览器弹出的确认框上点"允许"。
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this._closed) {
      throw new BrowserExternalError(
        "BROWSER_EXTERNAL_DISCONNECTED",
        "CDP client was closed and cannot be reused",
      );
    }

    const ws = new WebSocket(this.wsUrl);
    this._ws = ws;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => {
          this._teardownSocket();
          reject(new BrowserExternalError(
            "BROWSER_EXTERNAL_AUTH_TIMEOUT",
            `Timed out waiting for ${this.safeUrl} to accept the connection (${this.authTimeoutMs}ms)`,
            "The browser may still be showing its remote-debugging consent prompt.",
          ));
        });
      }, this.authTimeoutMs);
      if (typeof timer.unref === "function") timer.unref();

      ws.on("open", () => finish(() => {
        this._connected = true;
        resolve();
      }));

      ws.on("error", (err: any) => finish(() => {
        this._teardownSocket();
        const rawCode = String(err?.code || "");
        const detail = redactBrowserUrl(err?.message || String(err));
        if (CONNECT_REFUSED_CODES.has(rawCode)) {
          reject(new BrowserExternalError(
            "BROWSER_EXTERNAL_CONNECT_FAILED",
            `Cannot reach the browser at ${this.safeUrl}: ${detail}`,
            rawCode || null,
          ));
          return;
        }
        // 浏览器在握手阶段就拒绝：最现实的解释是用户还没在确认框上点允许，
        // 或者确认框被关掉了。用户要做的动作是"去看浏览器"，不是"检查进程"。
        reject(new BrowserExternalError(
          "BROWSER_EXTERNAL_AWAITING_AUTH",
          `The browser at ${this.safeUrl} refused the connection: ${detail}`,
          rawCode || null,
        ));
      }));

      ws.on("message", (data: any) => this._handleMessage(data));
      ws.on("close", () => this._handleClosed());
    });
  }

  /**
   * 发一条 CDP 命令并等待它的应答。
   * @param options.sessionId 页面级命令必须带上 attach 得到的 sessionId；不传即浏览器级命令。
   */
  async send(
    method: string,
    params: Record<string, any> = {},
    options: { sessionId?: string | null; timeoutMs?: number } = {},
  ): Promise<any> {
    if (!this.connected) {
      throw new BrowserExternalError(
        "BROWSER_EXTERNAL_DISCONNECTED",
        `Cannot run ${method}: the external browser connection is not open`,
      );
    }

    const sessionId = options.sessionId || null;
    const id = this._nextId++;
    const timeoutMs = options.timeoutMs ?? this.commandTimeoutMs;
    const key = pendingKey(id, sessionId);

    const message: Record<string, any> = { id, method, params };
    if (sessionId) message.sessionId = sessionId;

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(key);
        reject(new BrowserExternalError(
          "BROWSER_EXTERNAL_COMMAND_TIMEOUT",
          `Timed out waiting for ${method} on the external browser (${timeoutMs}ms)`,
          sessionId ? `session ${sessionId}` : null,
        ));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this._pending.set(key, { resolve, reject, timer, method });
      try {
        this._ws.send(JSON.stringify(message));
      } catch (err: any) {
        this._pending.delete(key);
        clearTimeout(timer);
        reject(new BrowserExternalError(
          "BROWSER_EXTERNAL_DISCONNECTED",
          `Failed to send ${method}: ${redactBrowserUrl(err?.message || String(err))}`,
        ));
      }
    });
  }

  /**
   * 附加到一个页面 target，返回可复用的 sessionId。
   * `flatten: true` 让子会话的消息平铺在这条 WS 上（否则 CDP 会要求另开一条连接）。
   */
  async attachToTarget(targetId: string): Promise<string> {
    const result = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const sessionId = result?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      throw new BrowserExternalError(
        "BROWSER_EXTERNAL_CONNECT_FAILED",
        "The browser accepted Target.attachToTarget without returning a sessionId",
      );
    }
    return sessionId;
  }

  /**
   * 解除会话。**必须**在浏览器级命令上带 `params.sessionId` —— 这是 CDP 的
   * 规定形状，漏掉会被回 -32602 InvalidParams。
   */
  async detachSession(sessionId: string): Promise<void> {
    if (!sessionId) return;
    try {
      await this.send("Target.detachFromTarget", { sessionId }, { timeoutMs: 5000 });
    } catch {
      // 会话可能已经被浏览器自己回收（页面关掉了）。这里的失败没有语义，
      // 绝不能因为它把一次成功的关标签变成错误。
    }
  }

  /** 关闭连接。绝不抛异常：调用方（server）没有补偿动作可做。 */
  async close(): Promise<void> {
    this._closed = true;
    const ws = this._ws;
    this._teardownSocket();
    this._failAllPending(new BrowserExternalError(
      "BROWSER_EXTERNAL_DISCONNECTED",
      "The external browser connection was closed",
    ));
    if (!ws) return;

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try { ws.terminate?.(); } catch { /* 已经死了 */ }
        finish();
      }, 2000);
      if (typeof timer.unref === "function") timer.unref();
      ws.once("close", finish);
      try {
        ws.close();
      } catch {
        finish();
      }
    });
  }

  _handleMessage(data: any) {
    let msg: any;
    try {
      msg = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return; // 非法帧：忽略，绝不能把整条连接带崩
    }

    // 事件（没有 id）走订阅者；应答（有 id）走 pending。
    if (msg == null || msg.id === undefined || msg.id === null) {
      if (typeof msg?.method !== "string") return;
      const event: CdpEvent = {
        method: msg.method,
        params: msg.params ?? {},
        sessionId: typeof msg.sessionId === "string" ? msg.sessionId : null,
      };
      for (const handler of [...this._eventHandlers]) {
        try { handler(event); } catch { /* 订阅者自己的错不该影响路由 */ }
      }
      return;
    }

    const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : null;
    const key = pendingKey(msg.id, sessionId);
    const pending = this._pending.get(key);
    if (!pending) return;
    this._pending.delete(key);
    clearTimeout(pending.timer);

    if (msg.error) {
      const detail = msg.error.message || JSON.stringify(msg.error);
      pending.reject(new BrowserExternalError(
        "BROWSER_EXTERNAL_UNSUPPORTED",
        `${pending.method} failed on the external browser: ${redactBrowserUrl(detail)}`,
        msg.error.code != null ? String(msg.error.code) : null,
      ));
      return;
    }
    pending.resolve(msg.result);
  }

  _handleClosed() {
    const wasConnected = this._connected;
    this._connected = false;
    this._ws = null;
    const err = new BrowserExternalError(
      "BROWSER_EXTERNAL_DISCONNECTED",
      "The external browser closed the CDP connection",
    );
    this._failAllPending(err);
    if (!wasConnected || this._fatalFired || this._closed) return;
    // 连上之后再断开 = 用户关了浏览器 / 浏览器崩溃 / 换了网络。必须让上层把
    // 该会话标记为不可用，而不是让后续每条命令各自超时。
    this._fatalFired = true;
    try { this._onFatal?.(err); } catch { /* 上层回调不该影响清理 */ }
  }

  _failAllPending(err: BrowserExternalError) {
    const entries = [...this._pending.entries()];
    this._pending.clear();
    for (const [, pending] of entries) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
  }

  _teardownSocket() {
    const ws = this._ws;
    this._ws = null;
    this._connected = false;
    if (!ws) return;
    try {
      ws.removeAllListeners?.("message");
      ws.terminate?.();
    } catch { /* 已经死了 */ }
  }
}