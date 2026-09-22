/**
 * core/gateway/gateway-client.ts — Jarvis 模型网关客户端 SDK（桌面端 Node 侧）。
 *
 * 覆盖云端免费额度路径（技术方案 §1/§2）：
 *   - 匿名设备注册与 token 管理（install_id 幂等，token 失效自动重注册一次）
 *   - HMAC-SHA256 请求签名（X-Timestamp / X-Signature，§1.3）
 *   - 品牌模型列表、额度查询、能力描述、本地模型清单、媒体任务
 *   - 聊天：非流式 chat() 与流式 chatStream()（SSE 解析，yield 增量文本）
 *
 * 不覆盖 BYOK——用户自己的 key 纯直连上游，永远不经过本模块（隐私硬承诺）。
 *
 * 配置：baseUrl / appSecret 由构造参数或环境变量注入
 * （JARVIS_GATEWAY_URL / JARVIS_GATEWAY_APP_SECRET）。
 * appSecret 内嵌客户端即可被逆向，仅抬高门槛；根本防线是服务端额度（§1.3）。
 */
import crypto from "crypto";
import os from "os";

import { AppError } from "../../shared/errors.ts";
import { resolveJarvisHome } from "../../shared/jarvis-runtime-paths.ts";
import {
  clearGatewayIdentity,
  deviceInfoHash,
  loadGatewayIdentity,
  resolveInstallId,
  saveGatewayIdentity,
  type GatewayIdentity,
} from "./gateway-store.ts";

const DEFAULT_BASE_URL = "https://gateway.bitjarvis.chat"; // 正式域名，部署后可用 JARVIS_GATEWAY_URL 覆盖
const RETRYABLE_AUTH_CODES = new Set(["token_invalid", "token_missing"]);

export type GatewayClientOptions = {
  baseUrl?: string;
  appSecret?: string;
  jarvisHome?: string;
  platform?: string;   // windows | macos | linux（默认从 process.platform 映射）
  appVersion?: string;
  line?: "cn" | "intl" | null; // 用户手动线路（§4.2 设置里的「线路选择」）
  fetchImpl?: typeof fetch;    // 测试注入
};

export type GatewayChatMessage = { role: string; content: unknown };

type FetchInit = RequestInit & { signal?: AbortSignal | null };

export class GatewayClient {
  private baseUrl: string;
  private appSecret: string;
  private jarvisHome: string;
  private platform: string;
  private appVersion: string;
  private line: "cn" | "intl" | null;
  private fetchImpl: typeof fetch;

  constructor(opts: GatewayClientOptions = {}) {
    this.baseUrl = (
      opts.baseUrl || process.env.JARVIS_GATEWAY_URL || DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    this.appSecret = opts.appSecret ?? process.env.JARVIS_GATEWAY_APP_SECRET ?? "";
    this.jarvisHome = opts.jarvisHome || resolveJarvisHome();
    this.platform = opts.platform || defaultPlatform();
    this.appVersion = opts.appVersion || "0.0.1";
    this.line = opts.line ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** OpenAI 兼容端点（provider 配置的 base_url 用它）。 */
  get chatBaseUrl(): string {
    return `${this.baseUrl}/v1`;
  }

  /** 当前已注册身份（未注册返回 null，不触发网络请求）。 */
  get identity(): GatewayIdentity | null {
    return loadGatewayIdentity(this.jarvisHome);
  }

  /** 有 token 直接用；没有则注册（install_id 幂等，重复注册换发新 token）。 */
  async ensureDevice(): Promise<GatewayIdentity> {
    const cached = loadGatewayIdentity(this.jarvisHome);
    if (cached?.token) return cached;
    return this.register();
  }

  async register(): Promise<GatewayIdentity> {
    const installId = resolveInstallId(this.jarvisHome);
    const body = JSON.stringify({
      install_id: installId,
      platform: this.platform,
      app_version: this.appVersion,
      device_info_hash: deviceInfoHash(),
    });
    const res = await this.rawRequest("POST", "/v1/devices/register", body, {});
    const data = (await res.json()) as any;
    if (!res.ok) throw toGatewayError(data, res.status);
    const identity: GatewayIdentity = {
      installId,
      deviceId: String(data.device_id || ""),
      token: String(data.token || ""),
      region: typeof data.region === "string" ? data.region : "cn",
      registeredAt: new Date().toISOString(),
    };
    if (!identity.deviceId || !identity.token) {
      throw new AppError("GATEWAY_UNAVAILABLE", { message: "注册响应缺少 device_id/token" });
    }
    saveGatewayIdentity(this.jarvisHome, identity);
    return identity;
  }

  /** 品牌模型列表（§2.1：auto/fast/balanced/strong，真实模型名不下发）。 */
  async listModels(signal?: AbortSignal): Promise<unknown> {
    return this.requestJson("GET", "/v1/models", undefined, signal);
  }

  /** 设备额度用量（驱动额度 UI 与「额度用尽」提示）。 */
  async getQuota(signal?: AbortSignal): Promise<unknown> {
    return this.requestJson("GET", "/v1/quota", undefined, signal);
  }

  /** 媒体能力描述（§6.2：驱动 UI 渲染，不支持的比例置灰）。 */
  async getCapabilities(signal?: AbortSignal): Promise<unknown> {
    return this.requestJson("GET", "/v1/capabilities", undefined, signal);
  }

  /** 本地模型分发清单（§7.2）。 */
  async getLocalManifest(platform?: string, signal?: AbortSignal): Promise<unknown> {
    const p = platform || this.platform;
    return this.requestJson("GET", `/v1/models/local/manifest?platform=${encodeURIComponent(p)}`, undefined, signal);
  }

  /** BYOK 直连目录：各提供商公开 base_url（纯公开信息，供客户端直连用）。 */
  async listByokProviders(signal?: AbortSignal): Promise<unknown> {
    return this.requestJson("GET", "/v1/byok/providers", undefined, signal);
  }

  /** 提交媒体任务（§5.4），返回 { job_id, status, poll_after_ms }。 */
  async submitMediaJob(params: {
    tier?: string; prompt: string; aspect_ratio?: string; quality?: string; n?: number;
  }, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson("POST", "/v1/media/jobs", params, signal);
  }

  async getMediaJob(jobId: string, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson("GET", `/v1/media/jobs/${encodeURIComponent(jobId)}`, undefined, signal);
  }

  /** 非流式聊天。返回 { text, usage, model }（model 为品牌名，非真实模型）。 */
  async chat(opts: {
    model: string;
    messages: GatewayChatMessage[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; usage: unknown; model: string }> {
    const data = (await this.requestJson("POST", "/v1/chat/completions", {
      model: opts.model,
      messages: opts.messages,
      stream: false,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    }, opts.signal)) as any;
    const choice = data?.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    if (!text) {
      throw new AppError("LLM_EMPTY_RESPONSE", { context: { model: opts.model, source: "gateway" } });
    }
    return { text, usage: data?.usage ?? null, model: String(data?.model ?? opts.model) };
  }

  /**
   * 流式聊天：解析 SSE，逐段 yield 增量文本（choices[0].delta.content）。
   * 网关已在源头改写真实模型名，此处无需再处理。
   */
  async *chatStream(opts: {
    model: string;
    messages: GatewayChatMessage[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<string, void, unknown> {
    const res = await this.authedFetch("POST", "/v1/chat/completions", {
      model: opts.model,
      messages: opts.messages,
      stream: true,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    }, opts.signal);
    if (!res.ok || !res.body) {
      throw toGatewayError(await res.json().catch(() => null), res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, "");
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") return;
          let chunk: any;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue; // 心跳/注释行
          }
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  // ---------- 内部 ----------

  private sign(bodyString: string): Record<string, string> {
    // X-Signature = hex(HMAC_SHA256(appSecret, timestamp + "\n" + body))（§1.3）
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = crypto.createHmac("sha256", this.appSecret).update(ts + "\n" + bodyString).digest("hex");
    return { "X-Timestamp": ts, "X-Signature": sig };
  }

  private assertConfigured() {
    // D 路线：appSecret 为空 = 桌面端无签名兼容模式（网关侧允许并记 compat 指标）。
    // 有 secret 就签名（移动端/CLI 可配），绝不因缺 secret 阻断请求。
  }

  /** 签名 + 发送。只有注册不需要设备 token，其余都走 authedFetch。 */
  private async rawRequest(
    method: string,
    path: string,
    bodyString: string,
    extraHeaders: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.appSecret ? this.sign(bodyString) : {}),
      ...extraHeaders,
    };
    if (this.line) headers["X-Line"] = this.line;
    const init: FetchInit = { method, headers };
    if (method !== "GET" && method !== "HEAD") init.body = bodyString;
    if (signal) init.signal = signal;
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, init);
    } catch (err) {
      throw new AppError("GATEWAY_UNAVAILABLE", {
        message: "无法连接网关服务",
        context: { baseUrl: this.baseUrl, path },
        cause: err,
      });
    }
    return res;
  }

  /** 带设备 token 的请求；token 失效时清本地身份并重注册重试一次（服务端幂等）。 */
  private async authedFetch(
    method: string,
    path: string,
    bodyObj?: unknown,
    signal?: AbortSignal,
    retried = false,
  ): Promise<Response> {
    const identity = await this.ensureDevice();
    const bodyString = bodyObj == null ? "" : JSON.stringify(bodyObj);
    const res = await this.rawRequest(method, path, bodyString, {
      Authorization: `Bearer ${identity.token}`,
    }, signal);
    if (res.status === 401 && !retried) {
      const data: any = await res.clone().json().catch(() => null);
      if (RETRYABLE_AUTH_CODES.has(data?.error?.code)) {
        clearGatewayIdentity(this.jarvisHome);
        return this.authedFetch(method, path, bodyObj, signal, true);
      }
    }
    return res;
  }

  private async requestJson(
    method: string,
    path: string,
    bodyObj?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const res = await this.authedFetch(method, path, bodyObj, signal);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw toGatewayError(data, res.status);
    return data;
  }
}

/** 网关错误 → AppError。quota_exceeded 的三选项（§1.4）放在 context.options 供 UI 渲染。 */
function toGatewayError(data: any, status: number): AppError {
  const err = data?.error ?? {};
  const code = typeof err.code === "string" ? err.code : "gateway_error";
  const message = typeof err.message === "string" ? err.message : `网关请求失败（HTTP ${status}）`;
  const appCode = code === "quota_exceeded"
    ? "GATEWAY_QUOTA_EXCEEDED"
    : "GATEWAY_UNAVAILABLE";
  return new AppError(appCode, {
    message,
    context: { status, code, options: data?.options },
  });
}

function defaultPlatform(): string {
  switch (os.platform()) {
    case "win32": return "windows";
    case "darwin": return "macos";
    default: return "linux";
  }
}

