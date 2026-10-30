// core/media/media-default-model-seed.ts
// 启动时把媒体默认模型矫正到 Jarvis Cloud 网关的当前档位（image / video）。
//
// 需要改写的情形（其余一律不动，尊重用户在设置里选的供应商/模型）：
//   1. 还没有默认模型（新用户）；
//   2. 默认模型仍指向旧版内置 jarvis 供应商（已下线）；
//   3. 默认模型指向已下线的网关旧档位（jarvis-gateway/standard）。
// 写回时只替换 defaultImageModel / defaultVideoModel，保留 providerDefaults 等其它字段。
import { GATEWAY_PROVIDER_ID } from "../gateway/gateway-sync.ts";
import {
  GATEWAY_IMAGE_TIER_ID,
  GATEWAY_VIDEO_TIER_ID,
  RETIRED_GATEWAY_MEDIA_TIER_ID,
} from "../media-protocols.ts";

/** 旧版内置供应商 id：其模型引用一律视为残留 */
const LEGACY_JARVIS_PROVIDER_ID = "jarvis";

type MediaModelRef = { provider?: string; id?: string } | null | undefined;

/** 该默认模型引用是否落在“应指向网关当前档位”的范围内 */
function needsGatewaySeed(ref: MediaModelRef, providerId: string): boolean {
  if (!ref || !ref.provider) return true;
  if (ref.provider === LEGACY_JARVIS_PROVIDER_ID) return true;
  return ref.provider === providerId && String(ref.id || "") === RETIRED_GATEWAY_MEDIA_TIER_ID;
}

/** 是否已经就是目标档位（避免无意义的重写与日志） */
function isGatewayTier(ref: MediaModelRef, providerId: string, tierId: string): boolean {
  return ref?.provider === providerId && String(ref?.id || "") === tierId;
}

/**
 * 矫正默认图片/视频模型；返回是否写盘，便于启动日志与测试断言。
 * prefs 只需实现 getImageGenerationConfig / getVideoGenerationConfig / _mutableCopy / savePreferences。
 */
export function seedGatewayMediaDefaultModels(deps: {
  prefs: any;
  providerId?: string;
  log?: (message: string) => void;
}): { changed: boolean; image: boolean; video: boolean } {
  const { prefs } = deps;
  const providerId = deps.providerId || GATEWAY_PROVIDER_ID;
  const log = deps.log || (() => {});
  const imageConfig = prefs.getImageGenerationConfig();
  const videoConfig = prefs.getVideoGenerationConfig();
  const nextPrefs = prefs._mutableCopy();
  let image = false;
  let video = false;

  if (needsGatewaySeed(imageConfig.defaultImageModel, providerId)
    && !isGatewayTier(imageConfig.defaultImageModel, providerId, GATEWAY_IMAGE_TIER_ID)) {
    nextPrefs.imageGeneration = {
      ...imageConfig,
      defaultImageModel: { provider: providerId, id: GATEWAY_IMAGE_TIER_ID },
    };
    image = true;
    log(`[media-default] set default image model to ${providerId}/${GATEWAY_IMAGE_TIER_ID}`);
  }

  if (needsGatewaySeed(videoConfig.defaultVideoModel, providerId)
    && !isGatewayTier(videoConfig.defaultVideoModel, providerId, GATEWAY_VIDEO_TIER_ID)) {
    nextPrefs.videoGeneration = {
      ...videoConfig,
      defaultVideoModel: { provider: providerId, id: GATEWAY_VIDEO_TIER_ID },
    };
    video = true;
    log(`[media-default] set default video model to ${providerId}/${GATEWAY_VIDEO_TIER_ID}`);
  }

  const changed = image || video;
  if (changed) prefs.savePreferences(nextPrefs);
  return { changed, image, video };
}