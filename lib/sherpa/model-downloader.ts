/**
 * model-downloader — B1 本地语音模型按需下载器（docs/SIZE_AND_STARTUP_OPT.md §6 B1）。
 *
 * 安装包只随附 sherpa-onnx 运行时（bin + onnxruntime + VAD），ASR/TTS 模型由
 * 用户首次启用本地语音时从清单（shared/sherpa-models.json，静态 import 内联进
 * bundle，无运行时文件解析）给出的 pinned URL 下载，落到用户级模型根
 * （core/realtime-voice/sherpa-paths.ts 的 userSherpaModelsBase，即
 * JARVIS_HOME/speech-models/<os-arch>/models/<kind>/<dir>/），适配器的多根
 * 解析自动发现，无需改任何配置。
 *
 * 流程：下载（fetch 流式 + curl 兜底）→ 系统 tar 解压（Win10+ 自带 bsdtar，
 * 支持 .tar.bz2；macOS/Linux 原生 tar）→ 展平一级目录 → 按清单 verify 校验
 * （sha256 非空查哈希、null 查存在）→ 清理归档与临时目录。已安装的模型直接
 * 返回 ready（幂等）。单任务运行：同一时刻最多一个下载。
 *
 * 镜像：环境变量 JARVIS_SHERPA_MIRROR 设置后，替换清单 URL 的
 * `https://github.com/k2-fsa/sherpa-onnx/releases/download` 前缀（发布侧把
 * 模型镜像到可达性更好的源，如 AtomGit；见 scripts/mirror-release-to-atomgit.mjs
 * 的发布管道约定）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { userSherpaModelsBase } from "../../core/realtime-voice/sherpa-paths.ts";
import sherpaModelsManifest from "../../shared/sherpa-models.json";

const GITHUB_RELEASES_PREFIX = "https://github.com/k2-fsa/sherpa-onnx/releases/download";

export type SherpaModelManifestEntry = {
  id: string;
  kind: "asr" | "tts";
  dir: string;
  archive: string;
  url: string;
  langs: string[];
  verify: Array<{ path: string; sha256: string | null }>;
};

export type SherpaInstallTaskState = {
  modelId: string;
  status: "downloading" | "extracting" | "verifying" | "ready" | "error";
  receivedBytes: number;
  totalBytes: number;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export function getSherpaModelsManifest(): { version: number; models: SherpaModelManifestEntry[] } {
  return sherpaModelsManifest as any;
}

function resolveModelUrl(url: string): string {
  const mirror = process.env.JARVIS_SHERPA_MIRROR || "";
  if (mirror && url.startsWith(GITHUB_RELEASES_PREFIX)) {
    return mirror.replace(/\/$/, "") + url.slice(GITHUB_RELEASES_PREFIX.length);
  }
  return url;
}

function fileExists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 模型目标目录（不存在不创建）：userBase/models/<kind>/<dir> */
export function sherpaModelTargetDir(model: SherpaModelManifestEntry): string {
  const base = userSherpaModelsBase();
  return path.join(base, "models", model.kind, model.dir);
}

/** 校验目标目录是否已就绪（verify 项全部通过）。 */
export function isModelInstalled(model: SherpaModelManifestEntry, targetDir = sherpaModelTargetDir(model)): boolean {
  if (!targetDir || !fileExists(targetDir)) return false;
  return (model.verify || []).every((entry) => {
    const file = path.join(targetDir, entry.path);
    if (!fileExists(file)) return false;
    if (!entry.sha256) return true; // 只要求存在
    try { return sha256File(file) === entry.sha256; } catch { return false; }
  });
}

// ── 单飞行任务状态 ──
let activeTask: SherpaInstallTaskState | null = null;

export function getSherpaInstallTaskState(): SherpaInstallTaskState | null {
  return activeTask;
}

export function isSherpaInstallBusy(): boolean {
  return !!activeTask && (activeTask.status === "downloading" || activeTask.status === "extracting" || activeTask.status === "verifying");
}

function curlAvailable(): string | null {
  for (const bin of ["curl.exe", "curl"]) {
    try {
      fs.accessSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", bin));
      if (bin === "curl.exe") return "curl.exe";
    } catch { /* not there */ }
  }
  // PATH 上的 curl（macOS/Linux/自定义安装）
  return process.platform === "win32" ? null : "curl";
}

function curlDownload(url: string, dest: string, maxTimeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = curlAvailable();
    if (!bin) return reject(new Error("curl not available"));
    const child = spawn(bin, [
      "-L", "--fail", "-sS",
      "--max-time", String(maxTimeSec),
      "-o", dest, url,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0 && fileExists(dest)) resolve();
      else reject(new Error(`curl download failed (code ${code}): ${stderr.slice(0, 200)}`));
    });
  });
}

async function downloadArchive(url: string, dest: string, task: SherpaInstallTaskState, timeoutMs: number, attempts: number): Promise<void> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      if (!response.body) throw new Error("empty response body");
      const total = Number(response.headers.get("content-length") || 0);
      task.totalBytes = total;
      task.receivedBytes = 0;
      const out = fs.createWriteStream(dest);
      const reader = (response.body as any).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        task.receivedBytes += value.byteLength;
        if (!out.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => out.once("drain", resolve));
        }
      }
      await new Promise<void>((resolve, reject) => {
        out.end(() => resolve());
        out.on("error", reject);
      });
      return;
    } catch (err) {
      lastErr = err;
      try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
    }
  }
  // fetch 多次失败 → curl 兜底（构建期脚本验证过的同款路径：undici 对部分
  // 网络（如 185.199.x.x 快照段）会 ECONNRESET，curl 直连成功）
  await curlDownload(url, dest, Math.ceil(timeoutMs / 1000));
}

/**
 * 解析 tar 可执行文件。Windows 显式用 System32 的 bsdtar（原生理解 C:\ 路径、
 * 自带 .bz2 支持）——PATH 上的 GNU tar（Git Bash/MSYS）会把 "C:\..." 解析成
 * 远程 host:path（"Cannot connect to C: resolve failed"），绝不能用。
 */
export function resolveTarBin(): string {
  if (process.platform === "win32") {
    return path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  }
  return "tar";
}

function extractTarBz2(archive: string, extractDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(extractDir, { recursive: true });
    const child = spawn(resolveTarBin(), ["-xjf", archive, "-C", extractDir], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => reject(new Error(`tar spawn failed: ${err?.message || err}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar extract failed (code ${code}): ${stderr.slice(0, 300)}`));
    });
  });
}

/** 展平解压产物的一级目录（归档内是 <name>/... 单层包装）。 */
function flattenExtractDir(extractDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  // 归档根下只有一个目录 → 把它的内容上移一级；否则认为已经是平铺结构
  if (entries.length === 1 && entries[0].isDirectory()) {
    const inner = path.join(extractDir, entries[0].name);
    for (const entry of fs.readdirSync(inner, { withFileTypes: true })) {
      fs.renameSync(path.join(inner, entry.name), path.join(targetDir, entry.name));
    }
    return;
  }
  for (const entry of entries) {
    fs.renameSync(path.join(extractDir, entry.name), path.join(targetDir, entry.name));
  }
}

export type StartInstallResult = {
  ok: boolean;
  status: "started" | "busy" | "already-installed" | "unknown-model";
  task?: SherpaInstallTaskState | null;
};

/**
 * 启动一个模型安装任务。幂等：已安装（verify 通过）直接 ready；
 * 已有任务在跑时返回 busy。任务状态经 getSherpaInstallTaskState 轮询。
 * 执行体在 runSherpaModelInstall（独立导出，测试可用显式清单条目直接驱动）。
 */
export function startSherpaModelInstall(modelId: string, opts: { log?: (msg: string) => void } = {}): StartInstallResult {
  const log = opts.log || (() => {});
  const model = (sherpaModelsManifest as any).models.find((m: SherpaModelManifestEntry) => m.id === modelId);
  if (!model) return { ok: false, status: "unknown-model" };
  if (isSherpaInstallBusy()) return { ok: false, status: "busy", task: activeTask };
  if (isModelInstalled(model)) {
    activeTask = {
      modelId,
      status: "ready",
      receivedBytes: 0,
      totalBytes: 0,
      error: null,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
    return { ok: true, status: "already-installed", task: activeTask };
  }

  if (!userSherpaModelsBase()) {
    activeTask = {
      modelId, status: "error", receivedBytes: 0, totalBytes: 0,
      error: "JARVIS_HOME is not set; cannot determine download location",
      startedAt: Date.now(), finishedAt: Date.now(),
    };
    return { ok: false, status: "started", task: activeTask };
  }

  const task: SherpaInstallTaskState = {
    modelId,
    status: "downloading",
    receivedBytes: 0,
    totalBytes: 0,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  activeTask = task;
  void runSherpaModelInstall(model, task, { log });
  return { ok: true, status: "started", task };
}

/**
 * 执行一次模型安装（下载 → 解压 → 展平 → 校验 → 清理），把过程态写进 task。
 * 失败不抛出（错误落 task.status="error"/task.error，供状态端点轮询）。
 * 独立导出：测试用显式清单条目（本地 http fixture）驱动，不必改全局 manifest。
 */
export async function runSherpaModelInstall(
  model: SherpaModelManifestEntry,
  task: SherpaInstallTaskState,
  opts: { log?: (msg: string) => void } = {},
): Promise<void> {
  const log = opts.log || (() => {});
  const base = userSherpaModelsBase();
  const targetDir = sherpaModelTargetDir(model);
  const downloadsDir = path.join(base, "downloads");
  const archivePath = path.join(downloadsDir, model.archive);
  const extractDir = path.join(downloadsDir, `${model.id}.extract`);
  const url = resolveModelUrl(model.url);
  const { timeoutMs, fetchAttempts } = (sherpaModelsManifest as any).downloader || { timeoutMs: 1_800_000, fetchAttempts: 3 };

  try {
    fs.mkdirSync(downloadsDir, { recursive: true });
    log(`[sherpa-models] downloading ${model.id} from ${url}`);
    await downloadArchive(url, archivePath, task, timeoutMs, fetchAttempts);
    task.status = "extracting";
    log(`[sherpa-models] extracting ${model.archive}`);
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
    await extractTarBz2(archivePath, extractDir);
    task.status = "verifying";
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch { /* ignore */ }
    flattenExtractDir(extractDir, targetDir);
    for (const entry of model.verify || []) {
      const file = path.join(targetDir, entry.path);
      if (!fileExists(file)) throw new Error(`verify failed: missing ${entry.path}`);
      if (entry.sha256 && sha256File(file) !== entry.sha256) {
        throw new Error(`verify failed: sha256 mismatch for ${entry.path}`);
      }
    }
    task.status = "ready";
    log(`[sherpa-models] ${model.id} installed at ${targetDir}`);
  } catch (err: any) {
    task.status = "error";
    task.error = String(err?.message || err);
    log(`[sherpa-models] ${model.id} install failed: ${task.error}`);
    // 失败清理：残留的半成品目录不留着（下次重装会先 rm 再解压，但显式
    // 清理让 status 的 isModelInstalled 不会误报 ready）
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch { /* ignore */ }
  } finally {
    task.finishedAt = Date.now();
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(archivePath, { force: true }); } catch { /* ignore */ }
  }
}
