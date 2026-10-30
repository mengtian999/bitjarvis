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
import { GATEWAY_IMAGE_TIER_ID, GATEWAY_VIDEO_TIER_ID } from "../media-protocols.ts";
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
    capabilities: {
      media: {
        // 档位 id 与 /v1/models 的 image / video 组同名（旧版 standard 档已下线）。
        // syncGatewayModels 会用网关实测到的档位覆盖 models，这里声明的是
        // 未联网/首次启动时的品牌档位与默认值，必须与线上档位保持一致。
        imageGeneration: {
          defaultModelId: GATEWAY_IMAGE_TIER_ID,
          models: [
            {
              id: GATEWAY_IMAGE_TIER_ID,
              displayName: "图片模型",
              protocolId: "gateway-images",
            },
          ],
        },
        videoGeneration: {
          defaultModelId: GATEWAY_VIDEO_TIER_ID,
          models: [
            {
              id: GATEWAY_VIDEO_TIER_ID,
              displayName: "视频模型",
              protocolId: "gateway-videos",
            },
          ],
        },
      },
    },
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
  /** A1：网关 /v1/models 下发的聊天档位视觉能力。缺省/旧网关 = false（文本档）。 */
  supports_image_input?: boolean;
  /** 档位上下文窗口（token）。0/缺省 = 服务端未声明，回落 FALLBACK_CONTEXT_WINDOW。 */
  context_window?: number;
  /** 档位单次最大输出（token）。0/缺省 = 服务端未声明，回落 FALLBACK_MAX_OUTPUT。 */
  max_output_tokens?: number;
};

/** 服务端未声明上下文预算时的保守兜底（多数上游的真实上限）。 */
const FALLBACK_CONTEXT_WINDOW = 131072;
const FALLBACK_MAX_OUTPUT = 16384;

function positiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
}

/**
 * 从扁平 data[] 取指定 kind 的档位。
 *
 * 单池后网关不再下发 pools / region（/v1/models 只有 {object, data}），
 * 档位按 kind 区分；同 id 去重（服务端已保证唯一，这里防御旧网关/多池残留）。
 */
function pickModels(data: any, kind: "chat" | "image" | "video"): GatewayModelEntry[] {
  const flat = Array.isArray(data?.data) ? data.data : [];
  const seen = new Set<string>();
  const out: GatewayModelEntry[] = [];
  for (const m of flat) {
    if (typeof m?.id !== "string" || !m.id) continue;
    if ((m.kind ?? "chat") !== kind) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
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

  const entries = pickModels(data, "chat");
  const models = entries.map((m) => {
    const supportsImageInput = m.supports_image_input === true;
    // 上下文预算由网关按档位下发（档位内轮转多个上游，服务端填的是最小值）。
    // 0/缺省 = 未声明 → 保守默认。绝不能写 500000 这种虚高值：
    // 自动压缩触发点是 contextWindow - max(16384, 10%)，填大了永远触发不到，
    // 长会话会在上游真实上限（多为 128K）处被 400 拒绝。
    const contextWindow = positiveInt(m.context_window) ?? FALLBACK_CONTEXT_WINDOW;
    const modelMaxOutput = positiveInt(m.max_output_tokens) ?? FALLBACK_MAX_OUTPUT;
    return {
      id: m.id,
      name: m.display_name && m.display_name.trim() ? m.display_name : m.id,
      api: "openai-completions",
      context: contextWindow,
      contextWindow,
      maxOutput: modelMaxOutput,
      // A1 多模态路由：视觉能力由网关 /v1/models 的 supports_image_input 下发。
      // 缺省（旧网关 / 未声明）= false（文本档）——绝不把图片块发给文本上游触发 400。
      // image 布尔驱动 Pi SDK 协议级附件门控；input 数组让 modelSupportsImageInput /
      // stripUnsupportedMediaParts / requiresAuxiliaryVision 一致生效：文本档的图片改走
      // 辅助视觉桥（graceful 描述）而非直接 400。视觉档由管理员在配置显式 opt-in。
      image: supportsImageInput,
      input: supportsImageInput ? ["text", "image"] : ["text"],
      reasoning: true,
      ...(m.login_required ? { loginRequired: true } : {}),
    };
  });
  if (models.length === 0) {
    return { ok: false, error: "网关模型列表为空" };
  }
  // 默认档：服务端 is_default 标记优先，其次 auto，兜底第一个
  const defaultModelId = entries.find((m) => m.is_default)?.id
    || (entries.some((m) => m.id === "auto") ? "auto" : entries[0].id);

  // 图片档位 → media.image_generation.models（每次全量替换，上下架跟随服务端）。
  // protocolId 不在此显式写入：加载时由 inferMediaProtocolId 按 providerId 推断（唯一推断入口）。
  const imageEntries = pickModels(data, "image");
  const imageModels = imageEntries.map((m) => ({
    id: m.id,
    name: m.display_name && m.display_name.trim() ? m.display_name : m.id,
  }));

  // 视频档位 → media.video_generation.models（每次全量替换，上下架跟随服务端）。
  const videoEntries = pickModels(data, "video");
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
