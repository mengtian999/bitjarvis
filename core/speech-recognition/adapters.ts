import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { resolveSherpaBin, resolveSherpaDir } from "../realtime-voice/sherpa-paths.ts";
import { getSpeechLanguage } from "../speech/speech-languages.ts";

const DEFAULT_MIME = "audio/wav";

export const openaiSpeechRecognitionAdapter = {
  id: "openai",
  name: "OpenAI Speech Recognition",
  protocolId: "openai-audio-transcriptions",
  types: ["speechRecognition"],
  async transcribe(input) {
    const { file, model, credentials } = input;
    const fetchImpl = resolveFetch(input);
    const baseUrl = trimTrailingSlash(credentials?.baseUrl || input.provider?.baseUrl || "https://api.openai.com/v1");
    const form = new FormData();
    form.set("model", model.id);
    if (input.language) form.set("language", input.language);
    form.set("file", await audioFileBlob(file), path.basename(file.filePath || file.realPath || "audio.wav"));
    const response = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials?.apiKey || ""}`,
      },
      body: form,
    });
    const body = await parseJsonResponse(response);
    assertOk(response, body, "OpenAI transcription failed");
    return {
      text: String(body.text || "").trim(),
      ...(input.language ? { language: input.language } : {}),
    };
  },
};

export const mimoSpeechRecognitionAdapter = {
  id: "mimo",
  name: "MiMo Speech Recognition",
  protocolId: "mimo-chat-completions-asr",
  types: ["speechRecognition"],
  async transcribe(input) {
    const fetchImpl = resolveFetch(input);
    const baseUrl = trimTrailingSlash(input.credentials?.baseUrl || input.provider?.baseUrl || "https://api.xiaomimimo.com/v1");
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "api-key": input.credentials?.apiKey || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model.id,
        messages: [audioChatMessage(audioDataUrl(input.file))],
        asr_options: {
          language: input.language || "auto",
        },
      }),
    });
    const body = await parseJsonResponse(response);
    assertOk(response, body, "MiMo transcription failed");
    return {
      text: extractChatCompletionText(body),
      language: input.language || "auto",
    };
  },
};

export const dashscopeSpeechRecognitionAdapter = {
  id: "dashscope",
  name: "DashScope Qwen ASR",
  protocolId: "dashscope-qwen-asr-chat",
  types: ["speechRecognition"],
  async transcribe(input) {
    const fetchImpl = resolveFetch(input);
    const baseUrl = trimTrailingSlash(input.credentials?.baseUrl || input.provider?.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1");
    const asrOptions = {
      ...(input.language ? { language: input.language } : {}),
      enable_itn: false,
    };
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.credentials?.apiKey || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model.id,
        messages: [audioChatMessage(audioDataUrl(input.file))],
        stream: false,
        asr_options: asrOptions,
      }),
    });
    const body = await parseJsonResponse(response);
    assertOk(response, body, "DashScope transcription failed");
    return {
      text: extractChatCompletionText(body),
      ...(input.language ? { language: input.language } : {}),
    };
  },
};

export const volcengineSpeechRecognitionAdapter = {
  id: "volcengine-speech",
  name: "Volcengine BigASR Speech Recognition",
  protocolId: "volcengine-bigasr-transcription",
  types: ["speechRecognition"],
  async transcribe(input) {
    const fetchImpl = resolveFetch(input);
    const baseUrl = trimTrailingSlash(input.credentials?.baseUrl || input.provider?.baseUrl || "https://openspeech.bytedance.com");
    const apiKey = input.credentials?.apiKey || "";
    const response = await fetchImpl(`${baseUrl}/api/v3/auc/bigmodel/recognize/flash`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "X-Api-Resource-Id": "volc.bigasr.auc_turbo",
        "X-Api-Request-Id": randomUUID(),
        "X-Api-Sequence": "-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user: { uid: apiKey },
        audio: { data: audioBase64(input.file) },
        request: {
          model_name: "bigmodel",
        },
      }),
    });
    const body = await parseJsonResponse(response);
    const statusCode = response.headers?.get?.("X-Api-Status-Code");
    if (statusCode && statusCode !== "20000000") {
      throw new Error(`Volcengine transcription failed: ${statusCode}`);
    }
    assertOk(response, body, "Volcengine transcription failed");
    return {
      text: String(body?.result?.text || "").trim(),
      ...(Number.isFinite(Number(body?.audio_info?.duration)) ? { durationMs: Number(body.audio_info.duration) } : {}),
      ...(input.language ? { language: input.language } : {}),
    };
  },
};

export const sherpaOnnxSpeechRecognitionAdapter = {
  id: "sherpa-onnx",
  name: "Sherpa-ONNX Speech Recognition (Local)",
  protocolId: "sherpa-onnx-asr",
  types: ["speechRecognition"],
  async transcribe(input) {
    const conf = resolveSherpaAsrConfig(input);
    const wavPath = input.file?.realPath || input.file?.filePath;
    if (!wavPath) throw new Error("sherpa-onnx asr: audio file path is required");
    const text = await runSherpaOfflineAsr(wavPath, input.model, conf, input.language);
    return { text };
  },
};

function resolveSherpaAsrConfig(input) {
  const raw = input?.localSpeech && typeof input.localSpeech === "object" ? input.localSpeech : {};
  const dir = resolveSherpaDir(input);
  const bin = raw.bin ? (path.isAbsolute(raw.bin) ? raw.bin : path.join(dir, raw.bin)) : resolveSherpaBin(dir, "sherpa-onnx-vad-with-online-asr");
  return { dir, bin };
}

/** 依据语言定位本地 ASR 模型目录(models/asr/<dir>);未命中回退 legacy 扫描。 */
function resolveAsrLanguageModelDir(baseDir, language) {
  const entry = getSpeechLanguage(language);
  const preferred = entry?.sherpaAsrModelDir;
  if (!preferred) return null;
  const candidate = path.join(baseDir, "models", "asr", preferred);
  return fs.existsSync(candidate) ? candidate : null;
}

function runSherpaOfflineAsr(wavPath, model, conf, language) {
  const modelDir = resolveAsrLanguageModelDir(conf.dir, language) || resolveModelDir(conf.dir, model, "asr");
  // SenseVoice 多语种离线模型(model.int8.onnx 为标志,zh/en/ja/ko/yue 单模型):
  // 走 sherpa-onnx-offline CLI;否则按流式 zipformer 走 vad-with-online-asr CLI
  const senseVoiceModel = modelDir
    ? [path.join(modelDir, "model.int8.onnx"), path.join(modelDir, "model.onnx")].find((p) => fs.existsSync(p))
    : "";
  if (senseVoiceModel) return runSenseVoiceAsr(wavPath, conf, modelDir, senseVoiceModel);
  return runStreamingZipformerAsr(wavPath, model, conf, modelDir);
}

function runSenseVoiceAsr(wavPath, conf, modelDir, senseVoiceModel) {
  const bin = resolveSherpaBin(conf.dir, "sherpa-onnx-offline") || conf.bin;
  if (!bin || !fs.existsSync(bin)) {
    throw new Error("sherpa-onnx offline asr binary not found; configure the sherpa dir in settings");
  }
  const args = [
    `--sense-voice-model=${senseVoiceModel}`,
    `--tokens=${path.join(modelDir, "tokens.txt")}`,
    // ITN:数字归一 + 标点恢复,听写/对话文本可直接使用
    "--sense-voice-use-itn=1",
    "--provider=cpu",
    wavPath,
  ];
  return new Promise(function (resolve, reject) {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout2 = "";
    let stderr2 = "";
    child.stdout.on("data", (chunk) => { stdout2 += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr2 += chunk.toString(); });
    child.on("error", (err) => reject(new Error(`sherpa-onnx asr spawn failed: ${err?.message || err}`)));
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error(`sherpa-onnx asr failed (exit ${code}): ${stderr2.trim()}`)); return; }
      resolve(parseSherpaResults(stdout2 + stderr2));
    });
  });
}

function runStreamingZipformerAsr(wavPath, model, conf, modelDir) {
  const bin = conf.bin || resolveSherpaBin(conf.dir, "sherpa-onnx-vad-with-online-asr");
  if (!bin || !fs.existsSync(bin)) {
    throw new Error("sherpa-onnx asr binary not found; configure the sherpa dir in settings");
  }
  const args = [`--tokens=${pickAsrModelFile(model, "tokens", ["tokens.txt", "tokens_combined.txt"], modelDir)}`];
  const encoder = pickAsrModelFile(model, "encoder", ["encoder-epoch-99-avg-1.onnx", "encoder.onnx", "encoder-epoch-98-avg-16.onnx"], modelDir);
  const decoder = pickAsrModelFile(model, "decoder", ["decoder-epoch-99-avg-1.onnx", "decoder.onnx"], modelDir);
  const joiner = pickAsrModelFile(model, "joiner", ["joiner-epoch-99-avg-1.onnx", "joiner.onnx"], modelDir);
  const vadModel = resolveVadModelPath(conf.dir);
  if (vadModel) args.push(`--silero-vad-model=${vadModel}`);
  if (encoder && fs.existsSync(encoder)) args.push(`--encoder=${encoder}`);
  if (decoder && fs.existsSync(decoder)) args.push(`--decoder=${decoder}`);
  if (joiner && fs.existsSync(joiner)) args.push(`--joiner=${joiner}`);
  args.push("--provider=cpu", "--decoding-method=greedy_search", wavPath);
  return new Promise(function (resolve, reject) {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout2 = "";
    let stderr2 = "";
    child.stdout.on("data", (chunk) => { stdout2 += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr2 += chunk.toString(); });
    child.on("error", (err) => reject(new Error(`sherpa-onnx asr spawn failed: ${err?.message || err}`)));
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error(`sherpa-onnx asr failed (exit ${code}): ${stderr2.trim()}`)); return; }
      resolve(parseSherpaResults(stdout2 + stderr2));
    });
  });
}

/** 解析 sherpa CLI 输出的识别文本。兼容两种格式:
 *  - 流式 CLI(vad-with-online-asr)的 "results: xxx" 行;
 *  - 离线 CLI(sherpa-onnx-offline, SenseVoice)末行输出的 JSON({"text": "..."})。 */
export function parseSherpaResults(output) {
  const texts = output.split(/\r?\n/).map((line) => {
    const trimmed = line && line.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed?.text === "string" ? parsed.text.trim() : "";
      } catch { return ""; }
    }
    const m = trimmed.match(/results?:\s*(.*)$/);
    return m ? m[1].trim() : "";
  }).filter((t) => t);
  return texts.join(" ").trim();
}

function resolveVadModelPath(baseDir) {
  try {
    for (const candidate of [
      path.join(baseDir, "models", "vad", "silero_vad.onnx"),
      path.join(baseDir, "silero_vad.onnx"),
      path.join(baseDir, "models", "silero_vad.onnx"),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* ignore */ }
  return "";
}

function pickAsrModelFile(model, key, candidates, modelDir) {
  const explicit = model?.files?.[key];
  if (explicit && typeof explicit === "string") return explicit;
  for (const candidate of candidates) {
    const resolved = modelDir ? path.join(modelDir, candidate) : candidate;
    try { if (fs.existsSync(resolved)) return resolved; } catch { }
  }
  // 候选不存在时，在 modelDir 中按 key 前缀扫描匹配文件（优先非 int8 量化版本）
  if (modelDir) {
    try {
      const prefix = key === "tokens" ? "tokens" : key;
      const ext = key === "tokens" ? ".txt" : ".onnx";
      let best = "";
      let bestInt8 = "";
      for (const entry of fs.readdirSync(modelDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(ext)) continue;
        const full = path.join(modelDir, entry.name);
        if (entry.name.includes(".int8.")) {
          if (!bestInt8) bestInt8 = full;
        } else if (!best) {
          best = full;
        }
      }
      return best || bestInt8 || candidates[0];
    } catch { /* ignore */ }
  }
  return candidates[0];
}

export const builtinSpeechRecognitionAdapters = [
  openaiSpeechRecognitionAdapter,
  mimoSpeechRecognitionAdapter,
  dashscopeSpeechRecognitionAdapter,
  volcengineSpeechRecognitionAdapter,
  sherpaOnnxSpeechRecognitionAdapter,
];

function resolveFetch(input) {
  if (typeof input.fetch === "function") return input.fetch;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  throw new Error("fetch is unavailable for speech recognition adapter");
}

async function audioFileBlob(file) {
  const filePath = file?.realPath || file?.filePath;
  if (!filePath) throw new Error("audio file path is required");
  const bytes = fs.readFileSync(filePath);
  return new Blob([bytes], { type: file.mime || DEFAULT_MIME });
}

function audioBase64(file) {
  const filePath = file?.realPath || file?.filePath;
  if (!filePath) throw new Error("audio file path is required");
  return fs.readFileSync(filePath).toString("base64");
}

function audioDataUrl(file) {
  return `data:${file?.mime || DEFAULT_MIME};base64,${audioBase64(file)}`;
}

function audioChatMessage(dataUrl) {
  return {
    role: "user",
    content: [{
      type: "input_audio",
      input_audio: { data: dataUrl },
    }],
  };
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function assertOk(response, body, fallbackMessage) {
  if (response.ok) return;
  const message = body?.error?.message || body?.message || body?.error || fallbackMessage;
  throw new Error(String(message));
}

function extractChatCompletionText(body) {
  const text = body?.choices?.[0]?.message?.content ?? body?.choices?.[0]?.delta?.content ?? "";
  return String(text).trim();
}

function resolveModelDir(baseDir, model, kind) {
  if (model?.files?.dir) return model.files.dir;
  const modelsDir = path.join(baseDir, "models", kind);
  try {
    for (const entry of fs.readdirSync(modelsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const candidate = path.join(modelsDir, entry.name);
        if (fs.existsSync(path.join(candidate, "tokens.txt")) || fs.existsSync(path.join(candidate, "encoder.onnx")) || fs.existsSync(path.join(candidate, "encoder-epoch-99-avg-1.onnx"))) {
          return candidate;
        }
      }
    }
  } catch { /* ignore */ }
  return baseDir;
}
