// shared/error-bus.ts
import { AppError } from './errors.ts';
import { redactLogText, redactLogValue } from './log-redactor.ts';


interface ErrorBusEntry {
  error: AppError;
  timestamp: number;
  breadcrumbs: Array<Record<string, unknown>>;
}

type ErrorBusRoute = 'statusbar' | 'boundary' | 'toast' | string;
type ErrorBusListener = (entry: ErrorBusEntry, route: ErrorBusRoute) => void;

interface ReportExtra {
  context?: Record<string, unknown>;
  dedupeKey?: string;
  route?: ErrorBusRoute;
}

interface ErrorBusOptions {
  dedupeWindowMs?: number;
}

/**
 * 同码错误的抑制窗口（默认 60 秒）。
 *
 * 以前是 5 秒：一次网络抖动 / 限流 / 超时会在重试链上以 5 秒为间隔反复进入 UI，
 * 叠加 inline 提示就变成用户感知到的「弹窗刷屏」。60 秒覆盖一整轮重试-退避周期
 * （client 侧 utility 调用 3 次尝试、网关侧 failover 都在秒级），同一码的错误在
 * 一轮故障里最多只暴露一次；日志侧也因此从「每条都记」变成「每轮记一次」。
 */
export const DEFAULT_ERROR_DEDUPE_WINDOW_MS = 60_000;

export class ErrorBus {
  _listeners: ErrorBusListener[];
  _breadcrumbs: Array<Record<string, unknown>>;
  _maxBreadcrumbs: number;
  _recentFingerprints: Map<string, number>;
  _dedupeWindowMs: number;

  constructor(options: ErrorBusOptions = {}) {
    this._listeners = [];
    this._breadcrumbs = [];
    this._maxBreadcrumbs = 50;
    this._recentFingerprints = new Map();
    this._dedupeWindowMs = Number.isFinite(options.dedupeWindowMs) && Number(options.dedupeWindowMs) > 0
      ? Math.floor(Number(options.dedupeWindowMs))
      : DEFAULT_ERROR_DEDUPE_WINDOW_MS;
  }

  addBreadcrumb(crumb: Record<string, unknown>): void {
    if (this._breadcrumbs.length >= this._maxBreadcrumbs) this._breadcrumbs.shift();
    this._breadcrumbs.push({ ...crumb, timestamp: Date.now() });
  }

  report(error: unknown, extra?: ReportExtra): void {
    const appErr = AppError.wrap(error);
    if (extra?.context) Object.assign(appErr.context, extra.context);

    const fingerprint = extra?.dedupeKey || appErr.code;
    const lastSeen = this._recentFingerprints.get(fingerprint);
    if (lastSeen && Date.now() - lastSeen < this._dedupeWindowMs) return;
    this._recentFingerprints.set(fingerprint, Date.now());

    if (this._recentFingerprints.size > 200) {
      const now = Date.now();
      for (const [k, v] of this._recentFingerprints) {
        if (now - v > this._dedupeWindowMs) this._recentFingerprints.delete(k);
      }
    }

    const route = extra?.route || this._autoRoute(appErr);
    const entry: ErrorBusEntry = {
      error: appErr,
      timestamp: Date.now(),
      breadcrumbs: [...this._breadcrumbs],
    };

    this._log(entry);

    for (const listener of this._listeners) {
      try { listener(entry, route); } catch { /* listener errors must not crash the bus */ }
    }
  }

  subscribe(listener: ErrorBusListener): () => void {
    this._listeners.push(listener);
    return () => { this._listeners = this._listeners.filter(l => l !== listener); };
  }

  _autoRoute(err: AppError): ErrorBusRoute {
    if (err.code === 'WS_DISCONNECTED') return 'statusbar';
    if (err.severity === 'critical') return 'boundary';
    // cosmetic 是「进展 / 噪音」级信号（例如 LLM_SLOW_RESPONSE 的慢响应上报，
    // 长思考模型每轮都会命中）：只保留日志和 breadcrumb，不升级成全局 toast。
    if (err.severity === 'cosmetic') return 'silent';
    return 'toast';
  }

  _log(entry: ErrorBusEntry): void {
    const { error } = entry;
    console.error(
      `[ErrorBus][${error.code}][${error.traceId}] ${redactLogText(error.message)}`,
      redactLogValue(error.context),
    );
  }
}

// Global singleton per process
export const errorBus = new ErrorBus();
