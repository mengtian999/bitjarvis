// core/media-adapters/gateway.ts
// Jarvis Cloud（网关）图片适配器：品牌档位 → POST /v1/media/jobs → 轮询 /v1/media/jobs/{id}。
//
// 媒体运行时候选模型即网关品牌档位名（standard/…，来自 /v1/models 的 image 组）；
// 真实上游模型只存在于服务端配置，不下发（§2.1）。
// submit 只返回 taskId（job_id），poller 调 query() 轮询；succeeded 时把
// result_urls 下载到 generated/ 并返回文件名（上游 URL 多为临时签名链接，
// 服务端转存对象存储属 P1，见 gateway internal/media）。
import fs from "node:fs";
import path from "node:path";
import { downloadImageUrls, normalizeImageInput } from "./common.ts";
import { GatewayClient } from "../gateway/gateway-client.ts";
import { loadGatewayIdentity, type GatewayIdentity } from "../gateway/gateway-store.ts";
import { resolveJarvisHome } from "../../shared/jarvis-runtime-paths.ts";

export const GATEWAY_IMAGE_PROTOCOL_ID = "gateway-images";
export const GATEWAY_VIDEO_PROTOCOL_ID = "gateway-videos";

/**
 * 网关支持的图片比例：对齐 Agnes Image 2.5 Flash。
 */
export const GATEWAY_IMAGE_RATIOS = Object.freeze(["1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2", "21:9"]);

/** 1K=standard（网关缺省），2K=hd（上游 quality: "hd"）。 */
export const GATEWAY_IMAGE_RESOLUTIONS = Object.freeze(["1K", "2K", "3K", "4K"]);

/** 网关支持的视频比例与参数。 */
export const GATEWAY_VIDEO_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"]);
export const GATEWAY_VIDEO_RESOLUTIONS = Object.freeze(["720p"]);
export const GATEWAY_VIDEO_DURATIONS = Object.freeze([5]);

type GatewayClientLike = {
  submitMediaJob: (params: any) => Promise<any>;
  getMediaJob: (jobId: string) => Promise<any>;
};

function safeFilenameBase(value: unknown, fallback: string): string {
  const text = String(value || fallback || "gateway-video").trim();
  return text
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff-]/g, "_")
    .slice(0, 80) || "gateway-video";
}

function extensionFromContentType(contentType: string | null | undefined): string {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("quicktime")) return "mov";
  return "mp4";
}

async function downloadVideoUrl(url: string, dataDir: string, filenameBase: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download video failed ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = extensionFromContentType(res.headers?.get?.("content-type"));
  const filename = `${safeFilenameBase(filenameBase, "gateway-video")}.${ext}`;
  const dir = path.join(dataDir, "generated");
  fs.mkdirSync(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, filename), buffer);
  return filename;
}

export function createGatewayImageAdapter(options: {
  createClient?: (opts?: any) => GatewayClientLike;
  resolveIdentity?: (jarvisHome?: string) => GatewayIdentity | null;
} = {}) {
  const createClient = options.createClient || ((opts) => new GatewayClient(opts));
  const resolveIdentity = options.resolveIdentity
    || ((home) => loadGatewayIdentity(home || resolveJarvisHome()));

  const client = (ctx?: any) => {
    const jarvisHome = ctx?.dataDir || resolveJarvisHome();
    return createClient({ jarvisHome });
  };

  return {
    id: "gateway-images",
    protocolId: GATEWAY_IMAGE_PROTOCOL_ID,
    name: "Jarvis Cloud Image",
    types: ["image"],
    aliases: ["jarvis-gateway-images", "jarvis-gateway"],
    capabilities: {
      ratios: [...GATEWAY_IMAGE_RATIOS],
      resolutions: [...GATEWAY_IMAGE_RESOLUTIONS],
      // 支持参考图输入（Agnes Image 2.5 Flash 图生图与多图合成）
      referenceImages: { min: 0, max: 3 },
    },

    async checkAuth(ctx: any = {}) {
      let identity: GatewayIdentity | null = null;
      try {
        const home = ctx?.dataDir || resolveJarvisHome();
        identity = resolveIdentity(home);
      } catch {
        identity = null;
      }
      if (identity?.token) return { ok: true };
      return {
        ok: false,
        code: "not_registered",
        message: "Jarvis Cloud 设备尚未注册，请先正常使用应用（会自动注册）后再生成图片",
      };
    },

    async submit(params: any = {}, ctx: any = {}) {
      const prompt = typeof params?.prompt === "string" ? params.prompt.trim() : "";
      if (!prompt) throw new Error("prompt is required");
      // modelId 即品牌档位名（媒体模型 id 由网关 /v1/models image 组下发）
      let rawTier = String(params?.modelId || params?.model || "standard").trim() || "standard";
      if (rawTier.includes("/")) {
        rawTier = rawTier.split("/").pop() || "standard";
      }
      const tier = rawTier || "standard";
      const body: {
        kind?: string;
        tier: string;
        prompt: string;
        n: number;
        aspect_ratio?: string;
        quality?: string;
        images?: string[];
      } = { kind: "image", tier, prompt, n: 1 };
      const ratio = params?.resolvedParameters?.ratio || params?.aspect_ratio || params?.ratio;
      if (typeof ratio === "string" && ratio.trim()) body.aspect_ratio = ratio.trim();
      const resolution = params?.resolvedParameters?.resolution || params?.resolution;
      if (/^(2k|hd)$/i.test(String(resolution || "").trim())) body.quality = "hd";
      const images = normalizeImageInput(params?.image || params?.referenceImages);
      if (images.length > 0) body.images = images;
      const job = await client(ctx).submitMediaJob(body);
      const jobId = job?.job_id;
      if (typeof jobId !== "string" || !jobId) throw new Error("网关未返回 job_id");
      return { taskId: jobId, providerTaskId: jobId };
    },

    async query(providerTaskId: any, ctx: any = {}) {
      const job = await client(ctx).getMediaJob(String(providerTaskId));
      const status = String(job?.status || "");
      if (status === "pending" || status === "running") return { status: "pending" };
      if (status !== "succeeded") {
        const message = typeof job?.error === "string" && job.error.trim()
          ? job.error.trim()
          : "网关图片任务失败";
        return { status: "failed", failReason: message, error: { code: "GATEWAY_MEDIA_FAILED", message } };
      }
      const urls = Array.isArray(job?.result_urls)
        ? job.result_urls.filter((url: any) => typeof url === "string" && url.trim())
        : [];
      if (urls.length === 0) {
        const message = "网关图片任务成功但未返回结果链接";
        return { status: "failed", failReason: message, error: { code: "GATEWAY_MEDIA_NO_FILE", message } };
      }
      const dataDir = typeof ctx?.dataDir === "string" && ctx.dataDir ? ctx.dataDir : resolveJarvisHome();
      const files = await downloadImageUrls(urls, dataDir);
      return { status: "success", files };
    },
  };
}

export function createGatewayVideoAdapter(options: {
  createClient?: (opts?: any) => GatewayClientLike;
  resolveIdentity?: (jarvisHome?: string) => GatewayIdentity | null;
} = {}) {
  const createClient = options.createClient || ((opts) => new GatewayClient(opts));
  const resolveIdentity = options.resolveIdentity
    || ((home) => loadGatewayIdentity(home || resolveJarvisHome()));

  const client = (ctx?: any) => {
    const jarvisHome = ctx?.dataDir || resolveJarvisHome();
    return createClient({ jarvisHome });
  };

  return {
    id: "gateway-videos",
    protocolId: GATEWAY_VIDEO_PROTOCOL_ID,
    name: "Jarvis Cloud Video",
    types: ["video"],
    aliases: ["jarvis-gateway-videos"],
    capabilities: {
      ratios: [...GATEWAY_VIDEO_RATIOS],
      resolutions: [...GATEWAY_VIDEO_RESOLUTIONS],
      durations: [...GATEWAY_VIDEO_DURATIONS],
      referenceImages: { min: 0, max: 2 },
    },

    async checkAuth(ctx: any = {}) {
      let identity: GatewayIdentity | null = null;
      try {
        const home = ctx?.dataDir || resolveJarvisHome();
        identity = resolveIdentity(home);
      } catch {
        identity = null;
      }
      if (identity?.token) return { ok: true };
      return {
        ok: false,
        code: "not_registered",
        message: "Jarvis Cloud 设备尚未注册，请先正常使用应用（会自动注册）后再生成视频",
      };
    },

    async submit(params: any = {}, ctx: any = {}) {
      const prompt = typeof params?.prompt === "string" ? params.prompt.trim() : "";
      if (!prompt) throw new Error("prompt is required");
      let rawTier = String(params?.modelId || params?.model || "standard").trim() || "standard";
      if (rawTier.includes("/")) {
        rawTier = rawTier.split("/").pop() || "standard";
      }
      const tier = rawTier || "standard";
      const body: {
        kind: string;
        tier: string;
        prompt: string;
        aspect_ratio?: string;
        seconds?: string;
        images?: string[];
        first_frame?: string;
        last_frame?: string;
      } = { kind: "video", tier, prompt };
      const ratio = params?.resolvedParameters?.ratio || params?.aspect_ratio || params?.aspectRatio || params?.ratio;
      if (typeof ratio === "string" && ratio.trim()) body.aspect_ratio = ratio.trim();
      const seconds = params?.resolvedParameters?.seconds || params?.seconds || params?.duration;
      if (seconds !== undefined && seconds !== null && String(seconds).trim()) body.seconds = String(seconds).trim();
      const images = normalizeImageInput(params?.image || params?.referenceImages);
      if (images.length > 0) body.images = images;
      if (params?.firstFrame || params?.first_frame) {
        body.first_frame = String(params?.firstFrame || params?.first_frame);
      }
      if (params?.lastFrame || params?.last_frame) {
        body.last_frame = String(params?.lastFrame || params?.last_frame);
      }
      const job = await client(ctx).submitMediaJob(body);
      const jobId = job?.job_id;
      if (typeof jobId !== "string" || !jobId) throw new Error("网关未返回 job_id");
      return { taskId: jobId, providerTaskId: jobId };
    },

    async query(providerTaskId: any, ctx: any = {}) {
      const job = await client(ctx).getMediaJob(String(providerTaskId));
      const status = String(job?.status || "");
      if (status === "pending" || status === "running") return { status: "pending" };
      if (status !== "succeeded") {
        const message = typeof job?.error === "string" && job.error.trim()
          ? job.error.trim()
          : "网关视频任务失败";
        return { status: "failed", failReason: message, error: { code: "GATEWAY_MEDIA_FAILED", message } };
      }
      const urls = Array.isArray(job?.result_urls)
        ? job.result_urls.filter((url: any) => typeof url === "string" && url.trim())
        : [];
      if (urls.length === 0) {
        const message = "网关视频任务成功但未返回结果链接";
        return { status: "failed", failReason: message, error: { code: "GATEWAY_MEDIA_NO_FILE", message } };
      }
      const dataDir = typeof ctx?.dataDir === "string" && ctx.dataDir ? ctx.dataDir : resolveJarvisHome();
      const filename = await downloadVideoUrl(urls[0], dataDir, String(providerTaskId));
      return { status: "success", files: [filename] };
    },
  };
}

export const gatewayImageAdapter = createGatewayImageAdapter();
export const gatewayVideoAdapter = createGatewayVideoAdapter();