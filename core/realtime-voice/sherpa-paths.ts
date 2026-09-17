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