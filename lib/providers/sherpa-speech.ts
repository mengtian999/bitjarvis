/**
 * sherpa-onnx 本地语音 provider plugin。
 *
 * 本地离线 ASR（流式/非流式识别）+ 本地离线 TTS，均走 sherpa-onnx 运行时。
 * authType: none —— 不需要凭据，二进制/模型路径由本地 sherpa 配置提供。
 */

/** @type {import('../../core/provider-registry.ts').ProviderPlugin} */
export const sherpaSpeechPlugin = {
  id: "sherpa-onnx",
  displayName: "Sherpa-ONNX 本地语音",
  authType: "none",
  defaultBaseUrl: "",
  defaultApi: "sherpa-onnx",
  capabilities: {
    media: {
      speechRecognition: {
        defaultModelId: "sherpa-asr",
        models: [
          {
            id: "sherpa-asr",
            displayName: "sherpa-onnx 本地识别",
            protocolId: "sherpa-onnx-asr",
            inputs: ["audio"],
            outputs: ["text"],
          },
        ],
      },
      speechGeneration: {
        defaultModelId: "sherpa-tts",
        models: [
          {
            id: "sherpa-tts",
            displayName: "sherpa-onnx 本地合成",
            protocolId: "sherpa-onnx-tts",
            inputs: ["text"],
            outputs: ["audio"],
            voice: "vits-zh",
          },
        ],
      },
    },
  },
};
