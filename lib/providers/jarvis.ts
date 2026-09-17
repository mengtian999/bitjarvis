/**
 * Jarvis (贾维斯) provider plugin — Agnes AI 国内版端点
 *
 * 协议与 agnes.ts 相同（OpenAI Completions），但 Base URL 指向 agnes-ai.cn 域名。
 * 内置预置 API Key，用户无需手动填写；API Key 输入框仅显示星号，不提供查看功能。
 */

import {
  enumParam,
  integerParam,
  mediaMode,
  noReferenceImages,
  referenceImages,
} from "./media-schema-helpers.ts";

const JARVIS_IMAGE_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"];
const JARVIS_VIDEO_RATIOS = ["3:2"];
const JARVIS_VIDEO_RESOLUTIONS = ["720p"];

const JARVIS_IMAGE_PROPERTIES = {
  ratio: enumParam(JARVIS_IMAGE_RATIOS, "3:2"),
  resolution: enumParam(["1K"], "1K"),
};
const JARVIS_IMAGE_DEFAULTS = { ratio: "3:2", resolution: "1K" };

const JARVIS_VIDEO_PROPERTIES = {
  ratio: enumParam(JARVIS_VIDEO_RATIOS, "3:2"),
  video_resolution: enumParam(JARVIS_VIDEO_RESOLUTIONS, "720p"),
  duration: integerParam({ minimum: 3, maximum: 18, defaultValue: 5 }),
  frame_rate: integerParam({ minimum: 1, maximum: 60, defaultValue: 24 }),
  num_frames: integerParam({ minimum: 81, maximum: 441 }),
};
const JARVIS_VIDEO_DEFAULTS = { ratio: "3:2", video_resolution: "720p", duration: 5, frame_rate: 24 };

/** @type {import('../../core/provider-registry.ts').ProviderPlugin} */
export const jarvisPlugin = {
  id: "jarvis",
  displayName: "Jarvis(贾维斯)",
  authType: "api-key",
  defaultBaseUrl: "https://apihub.agnes-ai.cn/v1",
  defaultApi: "openai-completions",
  /** 内置预置密钥；前端不展示明文，仅供后端初始化时使用 */
  defaultApiKey: "sk-nw9D7i0wjKKzhZeg4Iqos2FgrdOPEMVs5TOq5L7pAR74Bzad",
  /** 设为 true 时，前端 KeyInput 不渲染"显示密钥"按钮 */
  hideApiReveal: true,
  models: [
    {
      id: "agnes-3.0-flash",
      displayName: "Jarvis(贾维斯)",
      context: 500000,
      maxOutput: 65500,
      image: true,
      video: true,
      audio: true,
      reasoning: true,
    },
  ],
  capabilities: {
    media: {
      imageGeneration: {
        defaultModelId: "agnes-image-2.5-flash",
        models: [
          {
            id: "agnes-image-2.5-flash",
            displayName: "Agnes Image 2.5 Flash",
            protocolId: "agnes-images",
            inputs: ["text", "image"],
            outputs: ["image"],
            supportsEdit: true,
            modes: [
              mediaMode("text2image", "Text to image", JARVIS_IMAGE_PROPERTIES, JARVIS_IMAGE_DEFAULTS, noReferenceImages()),
              mediaMode("image2image", "Image edit/reference", JARVIS_IMAGE_PROPERTIES, JARVIS_IMAGE_DEFAULTS, referenceImages()),
            ],
            ratios: JARVIS_IMAGE_RATIOS,
            resolutions: ["1K"],
          },
        ],
      },
      videoGeneration: {
        defaultModelId: "agnes-video-2.5-flash",
        models: [
          {
            id: "agnes-video-2.5-flash",
            displayName: "Agnes Video 2.5 Flash",
            protocolId: "agnes-videos",
            inputs: ["text", "image"],
            outputs: ["video"],
            supportsAsync: true,
            modes: [
              mediaMode("text2video", "Text to video", JARVIS_VIDEO_PROPERTIES, JARVIS_VIDEO_DEFAULTS, noReferenceImages()),
              mediaMode("image2video", "Image to video", JARVIS_VIDEO_PROPERTIES, JARVIS_VIDEO_DEFAULTS, referenceImages({ max: 1 })),
              mediaMode("multiframe2video", "Multi-image to video", JARVIS_VIDEO_PROPERTIES, JARVIS_VIDEO_DEFAULTS, referenceImages({ min: 2 })),
            ],
            ratios: JARVIS_VIDEO_RATIOS,
            resolutions: JARVIS_VIDEO_RESOLUTIONS,
          },
        ],
      },
    },
  },
};
