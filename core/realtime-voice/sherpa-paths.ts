/**
 * sherpa-paths — 本地 sherpa-onnx 引擎的路径解析（打包随包 / 用户配置）。
 *
 * 优先序（dir）：
 *   1. 用户设置：preferences.sherpa.dir（localSpeech.dir）
 *   2. provider credentials.baseUrl
 *   3. 环境变量 JARVIS_SHERPA_DIR
 *   4. 随包路径：JARVIS_DESKTOP_RESOURCES_PATH/sherpa-onnx/<os>-<arch>
 *      （desktop/main.cjs 在打包模式下把 process.resourcesPath 注入该 env）
 *
 * 可执行文件候选：<dir>/bin/<bin>、<dir>/<bin>（win32 附加 .exe）。
 *
 * B1（docs/SIZE_AND_STARTUP_OPT.md §6）：ASR/TTS 模型不再随包内置，按需下载
 * 到用户级可写根目录（userSherpaModelsBase），模型目录解析走多根
 * （resolveSherpaModelDirMultiRoot）：引擎目录优先，用户级根兜底。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function sherpaPlatformDir(): string {
  const p = typeof process !== "undefined" ? process.platform : "linux";
  const a = typeof process !== "undefined" ? process.arch : "x64";
  if (p === "win32") return "win32-x64";
  if (p === "darwin") return a === "arm64" ? "darwin-arm64" : "darwin-x64";
  return "linux-x64";
}

/** 随包 base 目录：resourcesPath/sherpa-onnx/<platform>-<arch>/ */
export function bundledSherpaBase(): string {
  if (typeof process === "undefined") return "";
  const resources = process.env.JARVIS_DESKTOP_RESOURCES_PATH || "";
  if (resources) return path.join(resources, "sherpa-onnx", sherpaPlatformDir());
  // 开发模式回退：项目根 vendor/sherpa-onnx/<platform>-<arch>/
  try {
    const devPath = path.join(process.cwd(), "vendor", "sherpa-onnx", sherpaPlatformDir());
    if (fs.existsSync(devPath)) return devPath;
  } catch { /* ignore */ }
  return "";
}

/** 在配置 dir 与随包 dir 中寻找可执行文件（处理 bin/ 子目录与 .exe）。 */
export function resolveSherpaBin(baseDir: string, binName: string): string {
  const candidates: string[] = [];
  if (baseDir) {
    candidates.push(path.join(baseDir, binName), path.join(baseDir, "bin", binName));
    if (typeof process !== "undefined" && process.platform === "win32") {
      candidates.push(path.join(baseDir, binName + ".exe"), path.join(baseDir, "bin", binName + ".exe"));
    }
  }
  return candidates.find((c) => fileExists(c)) || candidates[0] || "";
}

export function fileExists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

/**
 * B1：用户级可写模型根目录——按需下载的本地语音模型落点
 * （`JARVIS_HOME/speech-models/<os-arch>/models/<kind>/<dir>/`）。安装包不再
 * 内置 ASR/TTS 模型（只留 bin + VAD），模型由 /api/sherpa/models/install
 * 下载到这里。优先级低于用户显式配置的引擎目录（resolveSherpaDir 的
 * prefs/credentials/env 分支），高于随包只读目录。
 */
export function userSherpaModelsBase(): string {
  if (typeof process === "undefined") return "";
  const home = process.env.JARVIS_HOME || "";
  if (!home) return "";
  return path.join(home, "speech-models", sherpaPlatformDir());
}

/**
 * B1：多根模型目录解析——先引擎目录（用户自定义 dir / 随包 base）下的
 * models/<kind>/<subDir>，再用户级模型根下的同名目录。返回第一个存在的目录；
 * 都不存在返回 null（调用方继续走各自的 legacy 扫描回退，null 契约不变）。
 */
export function resolveSherpaModelDirMultiRoot(
  engineDir: string,
  kind: "asr" | "tts",
  subDir: string,
): string | null {
  const candidates: string[] = [];
  if (engineDir) candidates.push(path.join(engineDir, "models", kind, subDir));
  const userBase = userSherpaModelsBase();
  if (userBase) candidates.push(path.join(userBase, "models", kind, subDir));
  return candidates.find((c) => fileExists(c)) || null;
}

/** 基于输入（localSpeech/credentials/env）解析一副引擎目录。 */
export function resolveSherpaDir(input: any): string {
  const raw = input?.localSpeech && typeof input.localSpeech === "object" ? input.localSpeech : {};
  return (
    raw.dir
    || raw.binDir
    || input?.credentials?.baseUrl
    || (typeof process !== "undefined" ? (process.env.JARVIS_SHERPA_DIR || "") : "")
    || bundledSherpaBase()
  );
}

/** 把本地合成的 WAV 落在系统临时目录。 */
export function temporarySynthesisPath(suffix = "wav"): string {
  const id = Math.random().toString(16).slice(2, 10);
  return path.join(os.tmpdir(), `jarvis-tts-${id}.${suffix}`);
}