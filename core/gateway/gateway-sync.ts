/**
 * core/gateway/gateway-sync.ts — 把网关模型组同步进 Provider Catalog。
 *
 * 效果（方案 §2.1：模型列表服务端下发，上下架不发版）：
 *   /v1/models 的品牌路由（auto/fast/balanced/strong）
 *   → providerRegistry.saveProvider("jarvis-gateway", { base_url, api, api_key, models })
 *   → model-manager 投影 → 模型选择器出现「网关模型组」
 *
 * 凭证胶水：api_key 就是匿名设备 token（Bearer 模式，D 路线决议——
 * 桌面端 Pi SDK 管道无法注入逐请求 HMAC 签名，网关侧已允许无签名 + 记 compat 指标）。
 * token 轮换（GatewayClient 自动重注册）后必须重新 sync 刷新 api_key。
 *
 * 失败语义：网关不可达时保留现有 provider 配置（不清空、不阻断启动），
 * 返回 { ok:false } 让调用方决定提示时机。
 */
import { AppError } from "../../shared/errors.ts";
import { isLocalProviderPlugin } from "../local-provider-plugin-store.ts";
import type { GatewayClient } from "./gateway-client.ts";

export const GATEWAY_PROVIDER_ID = "jarvis-gateway";

/**
 * 把 jarvis-gateway 注册为代码级 provider plugin（受管 provider）。
 *
 * 必须走 register() 而不是本地插件盘：hideApiReveal 只认插件声明
 * （provider-registry.ts:936），LocalProviderPlugin 的 JSON 白名单不收这个字段。
 * 效果：设置 → 供应商 中显示为「Jarvis Cloud」，且不再出现明文查看密钥的眼睛按钮
 * ——设备 token 是系统凭证，不该像 BYOK key 那样可随手复制。
 *
 * 旧版本同步曾把它写成本地插件盘（无 hideApiReveal），发现即清除改走代码注册；
 * remove() 会连带清掉 catalog overlay，但同步紧随其后会重新 saveProvider 写回。
 */
export function ensureGatewayProviderRegistered(deps: {
  providerRegistry: any;
  baseUrl: string;
  providerId?: string;
}): void {
  const { providerRegistry, baseUrl } = deps;
  const providerId = deps.providerId || GATEWAY_PROVIDER_ID;
  const existing = providerRegistry?._plugins?.get?.(providerId);
  if (existing && isLocalProviderPlugin(existing)) {
    providerRegistry.remove(providerId);
  }
  providerRegistry.register({
    id: providerId,
    displayName: "Jarvis Cloud",
    authType: "api-key",
    defaultApi: "openai-completions",
    defaultBaseUrl: baseUrl,
    hideApiReveal: true,
  });
}


export type GatewaySyncDeps = {
  client: GatewayClient;
  /** engine.providerRegistry（只需 saveProvider 方法，便于测试注入） */
  providerRegistry: { saveProvider: (providerId: string, data: Record<string, any>) => void };
  providerId?: string;
};

export type GatewaySyncResult =
  | { ok: true; models: string[]; defaultModelId: string; deviceId: string; imageModels: string[]; videoModels: string[] }
  | { ok: false; error: string };

type GatewayModelEntry = {
  id: string;
  display_name?: string;
  login_required?: boolean;
  kind?: string;
  is_default?: boolean;
  region?: string;
};

/**
 * 解析 /v1/models 响应，取当前地域的聊天模型组。
 * 网关响应键名是 pools（handlers.go:128 `{"object":"list","data":flat,"pools":pools}`）；
 * 旧版/兼容路径 regions 与扁平 data[] 都保留兜底，image/video 永不进聊天 provider。
 */
function pickChatModels(data: any, region: string): GatewayModelEntry[] {
  const grouped = data?.pools?.[region]?.chat ?? data?.regions?.[region]?.chat;
  if (Array.isArray(grouped) && grouped.length > 0) return grouped;
  const flat = Array.isArray(data?.data) ? data.data : [];
  return flat.filter((m: any) =>
    typeof m?.id === "string" && m.id
    && (!m.kind || m.kind === "chat")
    && (!m.region || m.region === region));
}

/**
 * 取当前地域的图片档位组（/v1/models pools.{region}.image）。
 * 档位 id（standard/…）即客户端图片模型的 modelId，
 * protocolId 由 inferMediaProtocolId("jarvis-gateway") 推断为 gateway-images。
 */
function pickImageModels(data: any, region: string): GatewayModelEntry[] {
  const grouped = data?.pools?.[region]?.image ?? data?.regions?.[region]?.image;
  if (Array.isArray(grouped) && grouped.length > 0) return grouped;
  const flat = Array.isArray(data?.data) ? data.data : [];
  return flat.filter((m: any) =>
    typeof m?.id === "string" && m.id
    && m.kind === "image"
    && (!m.region || m.region === region));
}

/**
 * 取当前地域的视频档位组（/v1/models pools.{region}.video）。
 * 档位 id（standard/…）即客户端视频模型的 modelId，
 * protocolId 由 inferMediaProtocolId("jarvis-gateway", "videoGeneration") 推断为 gateway-videos。
 */
function pickVideoModels(data: any, region: string): GatewayModelEntry[] {
  const grouped = data?.pools?.[region]?.video ?? data?.regions?.[region]?.video;
  if (Array.isArray(grouped) && grouped.length > 0) return grouped;
  const flat = Array.isArray(data?.data) ? data.data : [];
  return flat.filter((m: any) =>
    typeof m?.id === "string" && m.id
    && m.kind === "video"
    && (!m.region || m.region === region));
}

export async function syncGatewayModels(deps: GatewaySyncDeps): Promise<GatewaySyncResult> {
  const providerId = deps.providerId || GATEWAY_PROVIDER_ID;
  let identity;
  try {
    identity = await deps.client.ensureDevice();
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }

  let data: any;
  try {
    data = await deps.client.listModels();
  } catch (err) {
    // 网关不可达：保留既有配置，下次同步再试
    return { ok: false, error: errMsg(err) };
  }

  const entries = pickChatModels(data, identity.region || "cn");
  const models = entries.map((m) => ({
    id: m.id,
    name: m.display_name && m.display_name.trim() ? m.display_name : m.id,
    api: "openai-completions",
    ...(m.login_required ? { loginRequired: true } : {}),
  }));
  if (models.length === 0) {
    return { ok: false, error: "网关模型列表为空" };
  }
  // 默认档：服务端 is_default 标记优先，其次 auto，兜底第一个
  const defaultModelId = entries.find((m) => m.is_default)?.id
    || (entries.some((m) => m.id === "auto") ? "auto" : entries[0].id);

  // 图片档位 → media.image_generation.models（每次全量替换，上下架跟随服务端）。
  // protocolId 不在此显式写入：加载时由 inferMediaProtocolId 按 providerId 推断（唯一推断入口）。
  const imageEntries = pickImageModels(data, identity.region || "cn");
  const imageModels = imageEntries.map((m) => ({
    id: m.id,
    name: m.display_name && m.display_name.trim() ? m.display_name : m.id,
  }));

  // 视频档位 → media.video_generation.models（每次全量替换，上下架跟随服务端）。
  const videoEntries = pickVideoModels(data, identity.region || "cn");
  const videoModels = videoEntries.map((m) => ({
    id: m.id,
    name: m.display_name && m.display_name.trim() ? m.display_name : m.id,
  }));

  deps.providerRegistry.saveProvider(providerId, {
    base_url: deps.client.chatBaseUrl,
    api: "openai-completions",
    api_key: identity.token, // Bearer 设备 token；轮换后重新 sync 刷新
    models,
    media: {
      image_generation: { models: imageModels },
      video_generation: { models: videoModels },
    },
  });
  return {
    ok: true,
    models: models.map((m) => m.id),
    defaultModelId,
    deviceId: identity.deviceId,
    imageModels: imageModels.map((m) => m.id),
    videoModels: videoModels.map((m) => m.id),
  };
}

/**
 * 新用户默认模型：仅在用户从未设置过默认模型时指向网关 auto 档。
 * 老用户已有选择，绝不覆盖。
 */
export function ensureGatewayDefaultModel(deps: {
  modelManager: {
    defaultModel: any;
    setDefaultModel: (modelId: string, provider: string) => unknown;
  };
  providerId?: string;
  modelId?: string;
}): { changed: boolean } {
  const providerId = deps.providerId || GATEWAY_PROVIDER_ID;
  const modelId = deps.modelId || "auto";
  if (deps.modelManager.defaultModel) return { changed: false };
  try {
    deps.modelManager.setDefaultModel(modelId, providerId);
    return { changed: true };
  } catch (err) {
    // 模型尚未出现在 availableModels（sync 未完成）——不视为致命错误
    throw new AppError("GATEWAY_UNAVAILABLE", {
      message: "网关模型尚未同步完成，无法设为默认",
      cause: err,
    });
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
