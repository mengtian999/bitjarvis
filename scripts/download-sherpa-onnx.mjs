#!/usr/bin/env node
/**
 * download-sherpa-onnx.mjs — 拉取 sherpa-onnx 预编译运行时与模型到 vendor/sherpa-onnx/。
 *
 * 用法：
 *   node scripts/download-sherpa-onnx.mjs             # 当前平台运行时（默认）
 *   node scripts/download-sherpa-onnx.mjs --all       # 三个平台运行时（跨平台发布用）
 *   node scripts/download-sherpa-onnx.mjs --models    # 下载模型（默认 zh 语种 TTS + SenseVoice 多语种 ASR + VAD）
 *   node scripts/download-sherpa-onnx.mjs --models --langs=zh-CN,en,ja,ko   # 指定语言 TTS（或 --langs=all）
 *   node scripts/download-sherpa-onnx.mjs --check     # 只打印现状，不下载
 *
 * 产出布局（electron-builder extraResources → resources/sherpa-onnx/）：
 *   vendor/sherpa-onnx/<os>-<arch>/
 *     bin/sherpa-onnx-offline*   sherpa-onnx-offline-tts*   sherpa-onnx-online*
 *     lib/                       （依赖共享库，如有）
 *     models/vad/                （silero VAD）
 *     models/asr/sense-voice/    （SenseVoice 多语种 zh/en/ja/ko/yue）
 *     models/tts/{zh,kokoro-multi,ko}/   （--langs 决定下载哪些）
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = path.join(ROOT, "vendor", "sherpa-onnx");
const VERSION = "v1.13.5";
const REL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${VERSION}`;
const ASR_REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";
const TTS_REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";

const CURRENT_ARCH = {
  win32: "win32-x64",
  darwin: process.arch === "arm64" ? "darwin-arm64" : "darwin-x64",
  linux: "linux-x64",
}[process.platform];

const RUNTIME = {
  "win32-x64": {
    name: "sherpa-onnx-v1.13.5-win-x64-shared-MT-Release.tar.bz2",
    url: `${REL}/sherpa-onnx-v1.13.5-win-x64-shared-MT-Release.tar.bz2`,
    sha256: "70b7193e40ce5c393a218c6383069a64cf6479962ae87cdc19373b8b57e3f285",
  },
  "darwin-arm64": {
    name: "sherpa-onnx-v1.13.5-osx-arm64-shared.tar.bz2",
    url: `${REL}/sherpa-onnx-v1.13.5-osx-arm64-shared.tar.bz2`,
    sha256: "25e0443067e54cb69edf76a61cb458e9ebaabe62bd4a1d3ce7b560828a34663e",
  },
  "darwin-x64": {
    name: "sherpa-onnx-v1.13.5-osx-universal2-shared.tar.bz2",
    url: `${REL}/sherpa-onnx-v1.13.5-osx-universal2-shared.tar.bz2`,
    sha256: "1a89631e5975519dbdaf8e68ef5c8687693117e8b4155480c346601b1c3c6156",
  },
  "linux-x64": {
    name: "sherpa-onnx-v1.13.5-linux-x64-shared.tar.bz2",
    url: `${REL}/sherpa-onnx-v1.13.5-linux-x64-shared.tar.bz2`,
    sha256: "cb8943b10d286cc37831a69873d035ea285a26d639c8d687600cdbd5006bb00f",
  },
};

/**
 * 模型清单。dir 为 models/<kind>/ 下的目标目录名;TTS 目录按语言映射(与
 * core/speech/speech-languages.ts 的 sherpaTtsModelDir 对齐):
 *   zh-CN/zh-TW → zh(vits fanchen)  en/ja → kokoro-multi(kokoro 多语种)  ko → ko(mimic3)
 * ASR 用 SenseVoice 多语种单模型(zh/en/ja/ko/yue)→ models/asr/sense-voice。
 */
const LANG_TTS_DIRS = {
  "zh-CN": "zh",
  "zh-TW": "zh",
  "en": "kokoro-multi",
  "ja": "kokoro-multi",
  "ko": "ko",
};

const MODELS = [
  { kind: "vad", dir: "", name: "silero_vad.onnx", url: `${ASR_REL}/silero_vad.onnx`, sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6" },
  { kind: "asr", dir: "sense-voice", name: "sense-voice-zh-en-ja-ko-yue-int8.tar.bz2", url: `${ASR_REL}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2` },
  { kind: "tts", dir: "zh", name: "vits-zh-hf-fanchen-C.tar.bz2", url: `${TTS_REL}/vits-zh-hf-fanchen-C.tar.bz2` },
  { kind: "tts", dir: "kokoro-multi", name: "kokoro-multi-lang-v1_1.tar.bz2", url: `${TTS_REL}/kokoro-multi-lang-v1_1.tar.bz2` },
  { kind: "tts", dir: "ko", name: "vits-mimic3-ko_KO-kss_low.tar.bz2", url: `${TTS_REL}/vits-mimic3-ko_KO-kss_low.tar.bz2` },
];
function log(msg) { console.log(`[download-sherpa] ${msg}`); }

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function targetDir(arch) { return path.join(VENDOR_DIR, arch); }

function runtimePresent(arch) {
  const dir = path.join(targetDir(arch), "bin");
  for (const bin of ["sherpa-onnx-offline", "sherpa-onnx-offline-tts", "sherpa-onnx-online"]) {
    for (const ext of ["", ".exe"]) {
      if (fs.existsSync(path.join(dir, bin + ext))) return true;
    }
  }
  return false;
}

function modelPresent(model) {
  const base = path.join(targetDir(CURRENT_ARCH), "models", model.kind);
  const dir = model.dir ? path.join(base, model.dir) : base;
  if (!fs.existsSync(dir)) return false;
  // A directory alone is not enough: stageModels creates the model dir before
  // downloading, so an aborted download must not count as "present".
  return fs.readdirSync(dir).length > 0;
}

function selectedTtsDirs(langs) {
  const dirs = new Set();
  for (const lang of langs) {
    const dir = LANG_TTS_DIRS[lang];
    if (dir) dirs.add(dir);
  }
  return dirs;
}

function curlAvailable() {
  for (const bin of ["curl.exe", "curl"]) {
    try { execFileSync(bin, ["--version"], { stdio: "ignore" }); return bin; } catch { /* try next */ }
  }
  return null;
}

// Fallback transport. In some networks the CDN fronting github release assets
// accepts curl but resets node's undici connections (ECONNRESET against
// 185.199.x.x while curl routed to 198.18.0.47 for the same URL).
function curlDownload(url, dest, part, maxTimeSec) {
  const bin = curlAvailable();
  if (!bin) throw new Error("curl not found; cannot fall back to curl");
  try {
    execFileSync(bin, [
      "-sS", "-L", "--fail", "--show-error",
      "--retry", "3", "--retry-delay", "5", "--retry-all-errors",
      "--connect-timeout", "30", "--max-time", String(maxTimeSec),
      "-o", part, url,
    ], { stdio: "ignore" });
    fs.renameSync(part, dest);
  } finally {
    fs.rmSync(part, { force: true });
  }
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  log(`download ${url}`);
  // Retries are necessary: github release assets resolve through a CDN whose
  // addresses can intermittently fail the TCP connect (observed as
  // UND_ERR_CONNECT_TIMEOUT against 185.199.x.x while the same object
  // succeeded seconds later). This script is idempotent, so retrying is safe.
  const FETCH_ATTEMPTS = 2;
  // Overall safety net only. NOT a connect timeout: AbortSignal.timeout covers
  // the whole request including body streaming, so a short value aborts healthy
  // slow downloads of large files. Connection-layer failures already fail fast
  // on undici's own 10s connectTimeout (UND_ERR_CONNECT_TIMEOUT).
  const TIMEOUT_MS = 1800000;
  const CURL_MAX_TIME_SEC = 1800;
  const part = dest + ".part";
  let fetchErr;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      if (!response.body) throw new Error(`empty response body for ${url}`);
      const reader = response.body.getReader();
      const writer = fs.createWriteStream(part);
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(Buffer.from(value));
        total += value.length;
        process.stdout.write(`\r  ${(total / 1024 / 1024).toFixed(1)} MB downloaded`);
      }
      process.stdout.write("\n");
      await new Promise((resolve, reject) => {
        writer.end();
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
      fs.renameSync(part, dest);
      return;
    } catch (err) {
      fetchErr = err;
      fs.rmSync(part, { force: true });
      log(`download ${url}: fetch attempt ${attempt}/${FETCH_ATTEMPTS} failed (${err.cause ? err.cause.code : err.message})`);
      if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log(`download ${url}: fetch failed (${fetchErr && (fetchErr.cause ? fetchErr.cause.code : fetchErr.message)}), trying curl`);
  const t = Date.now();
  try {
    curlDownload(url, dest, part, CURL_MAX_TIME_SEC);
    log(`download ${url}: ok via curl in ${((Date.now() - t) / 1000).toFixed(0)}s`);
  } catch (err) {
    throw new Error(`download failed: ${url} (fetch: ${fetchErr && (fetchErr.cause ? fetchErr.cause.code : fetchErr.message)}; curl: ${err.message})`);
  }
}

function extractTarBz2(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xjf", archive, "-C", dest], { stdio: "inherit" });
}

function copyDir(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(to, { recursive: true }); copyDir(from, to); }
    else fs.copyFileSync(from, to);
  }
}
async function stageRuntime(arch) {
  const cfg = RUNTIME[arch];
  if (!cfg) { log(`no runtime for ${arch}, skip`); return; }
  if (runtimePresent(arch)) { log(`${arch}: runtime already present, skip`); return; }
  const tmp = path.join(ROOT, "vendor", ".tmp-sherpa", arch);
  fs.mkdirSync(tmp, { recursive: true });
  const archive = path.join(tmp, cfg.name);
  await download(cfg.url, archive);
  if (cfg.sha256 && sha256File(archive) !== cfg.sha256) {
    throw new Error(`SHA-256 mismatch for ${cfg.name}`);
  }
  const extractTo = path.join(tmp, "extract");
  extractTarBz2(archive, extractTo);
  fs.unlinkSync(archive);

  const buildDir = findBuildDir(extractTo, 0);
  if (!buildDir) throw new Error(`build dir not found in ${cfg.name}`);
  const out = targetDir(arch);
  fs.mkdirSync(path.join(out, "bin"), { recursive: true });
  copyDir(path.join(buildDir, "bin"), path.join(out, "bin"));
  if (fs.existsSync(path.join(buildDir, "lib"))) {
    fs.mkdirSync(path.join(out, "lib"), { recursive: true });
    copyDir(path.join(buildDir, "lib"), path.join(out, "lib"));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  log(`${arch}: runtime staged at ${out}`);
}

function findBuildDir(dir, depth) {
  if (depth > 4) return null;
  // 优先找名为 build 的目录（macOS/Linux 结构）
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === "build") return full;
  }
  // 找第一个包含 bin/ 子目录的目录（Windows 结构：sherpa-onnx-v1.13.5-win-x64-shared-MT-Release/bin/）
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      try {
        if (fs.readdirSync(full).some((n) => n === "bin")) return full;
      } catch { /* ignore */ }
    }
  }
  // 递归查找
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const found = findBuildDir(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function stageModels(langs) {
  const ttsDirs = selectedTtsDirs(langs);
  for (const model of MODELS) {
    // TTS 按所选语言下载;VAD 与多语种 ASR(SenseVoice)始终下载
    if (model.kind === "tts" && !ttsDirs.has(model.dir)) {
      log(`models/${model.kind}/${model.dir}: skipped (not in --langs=${langs.join(",")})`);
      continue;
    }
    if (modelPresent(model)) { log(`models/${model.kind}${model.dir ? "/" + model.dir : ""}: present, skip`); continue; }
    const modelDir = path.join(targetDir(CURRENT_ARCH), "models", model.kind, model.dir);
    fs.mkdirSync(modelDir, { recursive: true });
    const dest = path.join(modelDir, model.name);
    await download(model.url, dest);
    if (model.sha256 && sha256File(dest) !== model.sha256) throw new Error(`SHA-256 mismatch for ${model.name}`);
    // 如果模型是 tar.bz2 压缩包，解压到模型目录
    if (model.name.endsWith(".tar.bz2")) {
      const extractDir = path.join(modelDir, "extract");
      extractTarBz2(dest, extractDir);
      fs.unlinkSync(dest);
      // 将解压内容平铺到模型目录
      for (const entry of fs.readdirSync(extractDir, { withFileTypes: true })) {
        const from = path.join(extractDir, entry.name);
        const to = path.join(modelDir, entry.name);
        if (entry.isDirectory()) { fs.mkdirSync(to, { recursive: true }); copyDir(from, to); }
        else fs.copyFileSync(from, to);
      }
      fs.rmSync(extractDir, { recursive: true, force: true });
      log(`models/${model.kind}${model.dir ? "/" + model.dir : ""}: extracted`);
    }
  }
  log("models staged");
}

function check() {
  for (const arch of Object.keys(RUNTIME)) log(`${arch}: runtime ${runtimePresent(arch) ? "present" : "missing"} (${targetDir(arch)})`);
  for (const model of MODELS) log(`models/${model.kind}${model.dir ? "/" + model.dir : ""}: ${modelPresent(model) ? "present" : "missing"}`);
}

const args = new Set(process.argv.slice(2));
const optional = args.has("--optional");

// --langs=zh 或 --langs=zh,en,ja,ko / --langs=all:--models 时下载哪些语言的 TTS 模型
function parseLangs() {
  for (const arg of args) {
    if (typeof arg === "string" && arg.startsWith("--langs=")) {
      const value = arg.slice("--langs=".length).trim();
      if (value === "all") return ["zh-CN", "zh-TW", "en", "ja", "ko"];
      const langs = value.split(",").map((s) => s.trim()).filter(Boolean);
      const valid = langs.filter((l) => LANG_TTS_DIRS[l]);
      return valid.length ? valid : ["zh-CN"];
    }
  }
  return ["zh-CN"];
}

async function tryStage(label, fn) {
  try {
    await fn();
  } catch (err) {
    if (!optional) throw err;
    log(`WARN: ${label} failed (${err.message}) - continuing without ${label}`);
  }
}

if (args.has("--check")) {
  check();
} else {
  const archs = args.has("--all") ? Object.keys(RUNTIME) : [CURRENT_ARCH];
  for (const arch of archs) await tryStage(`runtime ${arch}`, () => stageRuntime(arch));
  if (args.has("--models")) await tryStage("models", () => stageModels(parseLangs()));
  check();
}