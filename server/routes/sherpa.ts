/**
 * sherpa route — 本地 sherpa-onnx 引擎状态查询与配置。
 *
 * GET  /api/sherpa/status              — 返回当前引擎状态（二进制/模型是否存在）
 * GET  /api/sherpa/config              — 读取用户配置的自定义引擎路径
 * PUT  /api/sherpa/config              — 更新用户配置的自定义引擎路径
 * GET  /api/sherpa/models/available    — B1：可按需下载的模型清单 + 安装状态
 * POST /api/sherpa/models/install      — B1：启动一个模型下载任务 {id}
 * GET  /api/sherpa/models/install/status — B1：当前下载任务进度
 */
import { Hono } from "hono";
import { safeJson } from "../hono-helpers.ts";
import { denyWithoutScope } from "../http/capability-guard.ts";
import { recordSecurityAuditEvent } from "../http/security-audit.ts";
import fs from "node:fs";
import path from "node:path";
import { SPEECH_LANGUAGES } from "../../core/speech/speech-languages.ts";
import {
  resolveSherpaModelDirMultiRoot,
  userSherpaModelsBase,
} from "../../core/realtime-voice/sherpa-paths.ts";
import {
  getSherpaInstallTaskState,
  getSherpaModelsManifest,
  isModelInstalled,
  startSherpaModelInstall,
} from "../../lib/sherpa/model-downloader.ts";

export function createSherpaRoute(engine) {
  const route = new Hono();

  route.get("/sherpa/status", async (c) => {
    try {
      const sherpaConfig = engine.preferences?.getSherpaConfig?.() || {};
      const dir = sherpaConfig.dir || "";
      // 检查随包路径
      const bundledBase = resolveBundledSherpaBase();
      const binDir = resolveBinDir(dir || bundledBase);

      const offlineBin = findBin(binDir, "sherpa-onnx-offline");
      const ttsBin = findBin(binDir, "sherpa-onnx-offline-tts");
      const modelsDir = dir ? path.join(dir, "models") : (bundledBase ? path.join(bundledBase, "models") : "");

      const vadPresent = modelsDir ? fileExists(path.join(modelsDir, "vad", "silero_vad.onnx")) : false;
      // B1：模型可能随包（旧版安装/全量构建）或在用户级按需下载根
      // （JARVIS_HOME/speech-models）——多根判定
      const asrPresent = !!resolveSherpaModelDirMultiRoot(dir || bundledBase, "asr", "");
      const ttsPresent = !!resolveSherpaModelDirMultiRoot(dir || bundledBase, "tts", "");
      // 五语种本地模型就绪清单(在线 Edge TTS 始终可用;本地按已下载模型判断)
      const languages = SPEECH_LANGUAGES.map((entry) => {
        const asrDir = entry.sherpaAsrModelDir
          ? resolveSherpaModelDirMultiRoot(dir || bundledBase, "asr", entry.sherpaAsrModelDir)
          : asrPresent;
        const ttsDirReady = entry.sherpaTtsModelDir
          ? resolveSherpaModelDirMultiRoot(dir || bundledBase, "tts", entry.sherpaTtsModelDir)
          : ttsPresent;
        return {
          id: entry.id,
          label: entry.label,
          localAsr: !!asrDir,
          localTts: !!ttsDirReady,
        };
      });

      return c.json({
        ready: !!(offlineBin || ttsBin),
        dir: dir || bundledBase || "",
        bin: {
          offline: !!offlineBin,
          tts: !!ttsBin,
          offlinePath: offlineBin || null,
          ttsPath: ttsBin || null,
        },
        models: {
          vad: vadPresent,
          asr: asrPresent,
          tts: ttsPresent,
        },
        languages,
        config: sherpaConfig,
      });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.get("/sherpa/config", async (c) => {
    try {
      return c.json(engine.preferences?.getSherpaConfig?.() || {});
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.put("/sherpa/config", async (c) => {
    try {
      const denied = denyWithoutScope(c, "settings.write");
      if (denied) return denied;
      const body = await safeJson(c);
      const values = body?.values && typeof body.values === "object" && !Array.isArray(body.values)
        ? body.values
        : body;
      const config = engine.preferences?.setSherpaConfig?.(values || {});
      recordSecurityAuditEvent(c, engine, {
        action: "settings.sherpa.update",
        target: "sherpa",
        metadata: { dir: config?.dir || "" },
      });
      return c.json({ ok: true, config: config || {} });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  // ── B1：模型按需下载（docs/SIZE_AND_STARTUP_OPT.md §6） ──

  route.get("/sherpa/models/available", async (c) => {
    try {
      const manifest = getSherpaModelsManifest();
      const models = manifest.models.map((m) => ({
        id: m.id,
        kind: m.kind,
        dir: m.dir,
        langs: m.langs || [],
        installed: isModelInstalled(m),
      }));
      return c.json({
        downloadRoot: userSherpaModelsBase(),
        models,
        task: getSherpaInstallTaskState(),
      });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/sherpa/models/install", async (c) => {
    try {
      const denied = denyWithoutScope(c, "settings.write");
      if (denied) return denied;
      const body = await safeJson(c);
      const id = typeof body?.id === "string" ? body.id.trim() : "";
      if (!id) return c.json({ error: "missing model id" }, 400);
      const result = startSherpaModelInstall(id, { log: (msg) => console.log(msg) });
      if (result.status === "unknown-model") return c.json({ error: "unknown model id" }, 404);
      if (result.status === "busy") return c.json({ error: "install_busy", task: result.task }, 409);
      recordSecurityAuditEvent(c, engine, {
        action: "settings.sherpa.modelInstall",
        target: id,
        metadata: { status: result.status },
      });
      return c.json({ ok: true, status: result.status, task: result.task });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  route.get("/sherpa/models/install/status", async (c) => {
    return c.json({ task: getSherpaInstallTaskState() });
  });

  return route;
}

function resolveBundledSherpaBase() {
  if (typeof process === "undefined") return "";
  const resources = process.env.JARVIS_DESKTOP_RESOURCES_PATH || "";
  if (resources) {
    const platform = process.platform === "win32" ? "win32-x64"
      : process.platform === "darwin"
        ? (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64")
        : "linux-x64";
    return path.join(resources, "sherpa-onnx", platform);
  }
  // 开发模式回退：项目根 vendor/sherpa-onnx/<platform>-<arch>/
  try {
    const platform = process.platform === "win32" ? "win32-x64"
      : process.platform === "darwin"
        ? (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64")
        : "linux-x64";
    const devPath = path.join(process.cwd(), "vendor", "sherpa-onnx", platform);
    if (fileExists(path.join(devPath, "bin"))) return devPath;
  } catch { /* ignore */ }
  return "";
}

function resolveBinDir(baseDir) {
  if (!baseDir) return "";
  // 尝试 bin/ 子目录，也尝试直接 baseDir
  for (const candidate of [path.join(baseDir, "bin"), baseDir]) {
    if (fileExists(candidate)) return candidate;
  }
  return baseDir;
}

function findBin(dir, name) {
  if (!dir) return null;
  for (const ext of ["", ".exe"]) {
    const full = path.join(dir, name + ext);
    if (fileExists(full)) return full;
  }
  return null;
}

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}