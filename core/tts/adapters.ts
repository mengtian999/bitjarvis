/**
 * Built-in text-to-speech (speech generation) adapters.
 * - microsoft-edge: Edge 朗读在线神经语音（免费、无 Key）。
 * - sherpa-onnx: 本地离线 TTS。
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { resolveSherpaBin, resolveSherpaDir } from "../realtime-voice/sherpa-paths.ts";
import { defaultEdgeVoiceForLanguage, getSpeechLanguage, voiceToSsmlLang } from "../speech/speech-languages.ts";

const EDGE_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_WS_BASE = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const EDGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const WIN_EPOCH = 11644473600; // Windows file time epoch offset (1601-01-01 to 1970-01-01)

export const microsoftEdgeTtsAdapter = {
  id: "microsoft-edge",
  name: "Microsoft Edge TTS",
  protocolId: "edge-tts",
  types: ["speechGeneration"],
  async synthesize(input) {
    if (!input.text || !String(input.text).trim()) throw new Error("edge-tts: text is required");
    const voiceName = resolveEdgeVoice(input);
    const rate = normalizeTtsRate(input.rate);
    const audio = await edgeTtsSynthesize(String(input.text), voiceName, rate);
    return { audio, text: String(input.text) };
  },
  /** 流式合成：每生成一个音频块即回调，适用于 SSE/MediaSource 流式播放。 */
  async streamSynthesize(input, onChunk, onDone, onError) {
    if (!input.text || !String(input.text).trim()) { const e = new Error("edge-tts: text is required"); if (onError) onError(e); else throw e; return; }
    const voiceName = resolveEdgeVoice(input);
    const rate = normalizeTtsRate(input.rate);
    edgeTtsStreamSynthesize(String(input.text), voiceName, rate, onChunk, onDone, onError);
  },
};

export const sherpaOnnxTtsAdapter = {
  id: "sherpa-onnx",
  name: "Sherpa-ONNX TTS (Local)",
  protocolId: "sherpa-onnx-tts",
  types: ["speechGeneration"],
  async synthesize(input) {
    if (!input.text || !String(input.text).trim()) throw new Error("sherpa-onnx tts: text is required");
    const conf = resolveSherpaConfig(input);
    const outWav = (await runSherpaOfflineTts(String(input.text), input.model, conf, input.language)) as string;
    // transient: 一次性产物,由 TtsService 读取后删除
    return { audio: { mimeType: "audio/wav", filePath: outWav, transient: true }, text: String(input.text) };
  },
  /** 流式合成:本地离线引擎只能整段产出,合成后按块回调(首块含 WAV 头),适用于 /api/voice。 */
  async streamSynthesize(input, onChunk, onDone, onError) {
    let outWav: string | null = null;
    try {
      if (!input.text || !String(input.text).trim()) throw new Error("sherpa-onnx tts: text is required");
      const conf = resolveSherpaConfig(input);
      outWav = (await runSherpaOfflineTts(String(input.text), input.model, conf, input.language)) as string;
      const raw = fs.readFileSync(outWav);
      const CHUNK = 16384;
      for (let i = 0; i < raw.length; i += CHUNK) onChunk(raw.subarray(i, i + CHUNK));
      onDone();
    } catch (err) {
      if (typeof onError === "function") onError(err);
      else throw err;
    } finally {
      if (outWav) { try { fs.rmSync(outWav, { force: true }); } catch { /* ignore */ } }
    }
  },
};

export const builtinTtsAdapters = [microsoftEdgeTtsAdapter, sherpaOnnxTtsAdapter];

export function normalizeTtsRate(value) {
  if (value === undefined || value === null || value === "") return "+0%";
  if (typeof value === "number" && Number.isFinite(value)) {
    const percent = Math.round((value - 1) * 100);
    return `${percent >= 0 ? "+" : ""}${percent}%`;
  }
  const raw = String(value).trim();
  const numeric = raw.replace(/%$/, "").trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(numeric)) {
    const n = parseFloat(numeric);
    return `${n >= 0 ? "+" : ""}${n}%`;
  }
  return "+0%";
}

/**
 * 音色解析顺序:显式 voice > 按语言取默认音色 > provider 声明 > 模型声明 > 简体中文默认。
 * 语言(config.language)是设置页「语音语言」落点,五语种见 speech-languages.ts。
 */
function resolveEdgeVoice(input) {
  if (typeof input.voice === "string" && input.voice.trim()) return input.voice.trim();
  if (typeof input.language === "string" && input.language.trim()) {
    return defaultEdgeVoiceForLanguage(input.language);
  }
  return input.model?.voice || input.provider?.defaultVoice || DEFAULT_VOICE;
}
// ── Microsoft Edge TTS ──
export function generateSecMsGec() {
  // Windows file time (1601-01-01 epoch) + 100-nanosecond intervals, rounded down to 5 minutes
  // Use BigInt to avoid precision loss above Number.MAX_SAFE_INTEGER
  const unixSec = BigInt(Math.floor(Date.now() / 1000));
  const winEpoch = BigInt(WIN_EPOCH);
  const fiveMin = BigInt(300);
  const hundredNs = BigInt(10000000);
  // ticks = unixSec + winEpoch, rounded down to 5 min, * 10,000,000
  const ticks = ((unixSec + winEpoch) / fiveMin) * fiveMin * hundredNs;
  const strToHash = ticks.toString() + EDGE_TRUSTED_CLIENT_TOKEN;
  return createHash("sha256").update(strToHash).digest("hex").toUpperCase();
}

function edgeDateStr() {
  // JavaScript-style date string: "Mon Aug 16 2026 12:00:00 GMT+0000 (Coordinated Universal Time)"
  const d = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return days[d.getUTCDay()] + " " + months[d.getUTCMonth()] + " " +
    String(d.getUTCDate()).padStart(2,"0") + " " + d.getUTCFullYear() + " " +
    String(d.getUTCHours()).padStart(2,"0") + ":" + String(d.getUTCMinutes()).padStart(2,"0") + ":" +
    String(d.getUTCSeconds()).padStart(2,"0") + " GMT+0000 (Coordinated Universal Time)";
}

function buildEdgeConfigMessage() {
  const ts = edgeDateStr();
  const body = '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"' +
    '},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"' +
    '}}}}';
  return "X-Timestamp:" + ts + "\r\n" +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" + body + "\r\n";
}

function buildEdgeSsmlMessage(text, voiceName, rate, requestId) {
  const ts = edgeDateStr();
  // xml:lang 由 voice 名推导(如 ja-JP-NanamiNeural → ja-JP),保证分词与发音引擎正确
  const ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + voiceToSsmlLang(voiceName) + "'>" +
    "<voice name='" + voiceName + "'><prosody pitch='+0Hz' rate='" + rate + "' volume='+0%'>" +
    escapeXml(text) + "</prosody></voice></speak>";
  return "X-RequestId:" + requestId + "\r\n" +
    "Content-Type:application/ssml+xml\r\n" +
    "X-Timestamp:" + ts + "Z\r\n" +
    "Path:ssml\r\n\r\n" + ssml;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function edgeTtsSynthesize(text, voiceName, rate) {
  return new Promise((resolve, reject) => {
    const audioChunks = [];
    edgeTtsStreamSynthesize(
      text, voiceName, rate,
      (chunk) => audioChunks.push(chunk),
      () => {
        const total = Buffer.concat(audioChunks);
        if (total.length === 0) { reject(new Error("edge-tts: no audio received")); return; }
        resolve({ mimeType: "audio/mpeg", data: total.toString("base64") });
      },
      (err) => reject(err),
    );
  });
}

/**
 * Stream Edge TTS: calls onChunk(buffer) for each audio chunk, onDone() when finished.
 */
function edgeTtsStreamSynthesize(text, voiceName, rate, onChunk, onDone, onError) {
  const connectionId = randomUUID();
  const gec = generateSecMsGec();
  const gecVersion = "1-143.0.3650.75";
  const url = EDGE_WS_BASE
    + "?TrustedClientToken=" + EDGE_TRUSTED_CLIENT_TOKEN
    + "&ConnectionId=" + connectionId
    + "&Sec-MS-GEC=" + gec
    + "&Sec-MS-GEC-Version=" + gecVersion;

  let settled = false;
  const muid = randomUUID().replace(/-/g, "").toUpperCase();
  const ws = new WebSocket(url, {
    headers: {
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
      "Origin": EDGE_ORIGIN,
      "User-Agent": EDGE_USER_AGENT,
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Cookie": "muid=" + muid + ";",
    },
  });

  const fail = (err) => {
    if (settled) return;
    settled = true;
    try { ws.close(); } catch { }
    if (typeof onError === "function") onError(err);
  };

  ws.on("open", () => {
    try {
      ws.send(buildEdgeConfigMessage());
      ws.send(buildEdgeSsmlMessage(text, voiceName, rate, connectionId));
    } catch (err) { fail(err); }
  });

  ws.on("message", (data, isBinary) => {
    try {
      if (isBinary) {
        const [header, payload] = splitEdgeBinary(data);
        // Edge TTS 的二进制音频块用 Content-Type:audio/mpeg 标识（不含 Path:audio）
        if (header && header.includes("Content-Type:audio")) {
          if (typeof onChunk === "function") onChunk(payload);
        }
        return;
      }
      const message = data.toString();
      if (message.includes("Path:turn.end")) {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { }
        if (typeof onDone === "function") onDone();
      } else if (message.includes("Path:response")) {
        const meta = extractJsonFromEdgeMessage(message);
        if (meta && (meta.error || meta.name === "error")) {
          fail(new Error("edge-tts: " + ((meta.error && meta.error.message) || "upstream error")));
        }
      }
    } catch (err) { fail(err); }
  });

  ws.on("error", (err) => fail(err));
  ws.on("close", () => {
    if (!settled) fail(new Error("edge-tts: connection closed before synthesis finished"));
  });
}

export function splitEdgeBinary(buffer) {
  // Edge TTS 二进制消息格式：2字节大端头长度 + header文本 + \r\n + payload
  if (buffer.length < 3) return ["", buffer];
  const headerLen = buffer.readUInt16BE(0);
  const headerStart = 2;
  const headerEnd = Math.min(headerStart + headerLen, buffer.length);
  const header = buffer.subarray(headerStart, headerEnd).toString("utf8");
  // header 之后有一个 \r\n，然后是 payload
  let payloadStart = headerEnd;
  if (buffer.subarray(headerEnd, headerEnd + 2).toString("latin1") === "\r\n") {
    payloadStart = headerEnd + 2;
  }
  return [header, buffer.subarray(payloadStart)];
}

function extractJsonFromEdgeMessage(message) {
  const idx = message.indexOf("\r\n\r\n");
  const body = idx === -1 ? message : message.slice(idx + 4);
  try { return JSON.parse(body); } catch { return null; }
}
// ── sherpa-onnx 本地 TTS ──
function resolveSherpaConfig(input) {
  const raw = input.localSpeech && typeof input.localSpeech === "object" ? input.localSpeech : {};
  const dir = resolveSherpaDir(input);
  const bin = raw.bin ? (path.isAbsolute(raw.bin) ? raw.bin : path.join(dir, raw.bin)) : resolveSherpaBin(dir, "sherpa-onnx-offline-tts");
  return { dir, bin };
}

/** 依据语言定位本地模型目录(models/tts/<dir>);语言未配置或目录不存在时回退 legacy 扫描。 */
function resolveLanguageModelDir(baseDir, language, kind) {
  const entry = getSpeechLanguage(language);
  const preferred = kind === "tts" ? entry?.sherpaTtsModelDir : entry?.sherpaAsrModelDir;
  if (!preferred) return null;
  const candidate = path.join(baseDir, "models", kind, preferred);
  return fileExists(candidate) ? candidate : null;
}

function runSherpaOfflineTts(text, model, conf, language) {
  const bin = conf.bin || resolveSherpaBin(conf.dir, "sherpa-onnx-offline-tts");
  if (!bin || !fileExists(bin)) {
    throw new Error("sherpa-onnx offline tts binary not found; configure the sherpa dir in settings");
  }
  const modelDir = resolveLanguageModelDir(conf.dir, language, "tts") || resolveModelDir(conf.dir, model, "tts");
  if (modelDir && !fileExists(modelDir)) {
    throw new Error(`sherpa-onnx tts model dir not found: ${modelDir}`);
  }
  const outputFile = path.join(os.tmpdir(), `jarvis-tts-${randomUUID()}.wav`);
  // kokoro 多语种模型(voices.bin 为标志,覆盖 zh/en/ja)与 vits 系模型参数不同
  const isKokoro = Boolean(modelDir && fileExists(path.join(modelDir, "voices.bin")));
  let args;
  if (isKokoro) {
    const entry = getSpeechLanguage(language);
    const kokoroVoice = entry?.sherpaKokoroVoice;
    args = [
      `--kokoro-model=${pickModelFile(model, "kokoroModel", ["model.int8.onnx", "model.onnx"], modelDir)}`,
      `--kokoro-voices=${path.join(modelDir, "voices.bin")}`,
      `--kokoro-tokens=${pickModelFile(model, "tokens", ["tokens.txt"], modelDir)}`,
      `--kokoro-data-dir=${path.join(modelDir, "espeak-ng-data")}`,
      `--output-filename=${outputFile}`,
      String(text),
    ];
    if (fileExists(path.join(modelDir, "lexicon.txt"))) args.push(`--kokoro-lexicon=${path.join(modelDir, "lexicon.txt")}`);
    if (fileExists(path.join(modelDir, "dict"))) args.push(`--kokoro-dict-dir=${path.join(modelDir, "dict")}`);
    if (kokoroVoice) args.push(`--sid=${kokoroVoice}`);
  } else {
    args = [
      `--vits-model=${pickModelFile(model, "vitsModel", ["vits-model.onnx", "model.onnx"], modelDir)}`,
      `--vits-lexicon=${pickModelFile(model, "lexicon", ["vits-lexicon.txt", "lexicon.txt"], modelDir)}`,
      `--vits-tokens=${pickModelFile(model, "tokens", ["vits-tokens.txt", "tokens.txt"], modelDir)}`,
      `--output-filename=${outputFile}`,
      String(text),
    ];
    if (model?.files?.dataDir) args.push(`--vits-data-dir=${model.files.dataDir}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => reject(new Error(`sherpa-onnx tts spawn failed: ${err?.message || err}`)));
    child.on("close", (code) => {
      if (code !== 0 || !fileExists(outputFile)) {
        reject(new Error(`sherpa-onnx tts failed (exit ${code}): ${stderr.trim()}`));
        return;
      }
      resolve(outputFile);
    });
  });
}

function pickModelFile(model, key, candidates, modelDir) {
  const explicit = model?.files?.[key];
  if (explicit && typeof explicit === "string") return explicit;
  for (const candidate of candidates) {
    const resolved = modelDir ? path.join(modelDir, candidate) : candidate;
    if (fileExists(resolved)) return resolved;
  }
  // 候选不存在时，在 modelDir 中扫描匹配扩展名的文件（适用于实际文件名与默认候选不一致的模型）
  if (modelDir) {
    try {
      const isOnnx = key === "vitsModel" || key === "encoder" || key === "decoder" || key === "joiner" || key === "zipformer";
      const ext = isOnnx ? ".onnx" : ".txt";
      for (const entry of fs.readdirSync(modelDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(ext)) {
          return path.join(modelDir, entry.name);
        }
      }
    } catch { /* ignore */ }
  }
  return candidates[0];
}

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function resolveModelDir(baseDir, model, kind) {
  if (model?.files?.dir) return model.files.dir;
  const modelsDir = path.join(baseDir, "models", kind);
  try {
    for (const entry of fs.readdirSync(modelsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const candidate = path.join(modelsDir, entry.name);
        if (fs.existsSync(path.join(candidate, "tokens.txt")) || fs.existsSync(path.join(candidate, "lexicon.txt")) || fs.existsSync(path.join(candidate, "vits-lexicon.txt"))) {
          return candidate;
        }
      }
    }
  } catch { /* ignore */ }
  return baseDir;
}
