/**
 * Microsoft Edge TTS provider plugin.
 *
 * 免费的在线微软神经语音（Edge 朗读端点），无需 API Key。走 speech_generation
 * 能力位，适配器协议 edge-tts。
 *
 * 音色目录来自 core/speech/speech-languages.ts（简中/繁中/日/韩/英五语种单一数据源），
 * 随 /api/speech-generation/providers 下发，设置页按语言过滤展示。
 */
import { SPEECH_LANGUAGES } from "../../core/speech/speech-languages.ts";

/** @type {import('../../core/provider-registry.ts').ProviderPlugin} */
export const microsoftSpeechPlugin = {
  id: "microsoft-edge",
  displayName: "微软 Edge TTS",
  authType: "none",
  defaultBaseUrl: "",
  defaultApi: "edge-tts",
  defaultVoice: "zh-CN-XiaoxiaoNeural",
  capabilities: {
    media: {
      speechGeneration: {
        defaultModelId: "edge-tts",
        models: [
          {
            id: "edge-tts",
            displayName: "Edge 神经语音",
            protocolId: "edge-tts",
            inputs: ["text"],
            outputs: ["audio"],
            voice: "zh-CN-XiaoxiaoNeural",
            languages: SPEECH_LANGUAGES.map((entry) => ({
              id: entry.id,
              label: entry.label,
              ssmlLang: entry.ssmlLang,
              defaultVoice: entry.edgeDefaultVoice,
              voices: entry.edgeVoices,
              sampleText: entry.sampleText,
            })),
          },
        ],
      },
    },
  },
};
