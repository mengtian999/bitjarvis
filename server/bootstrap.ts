import path from "path";
import { pathToFileURL } from "url";
import { Worker } from "worker_threads";
import { enableCompileCache } from "node:module";
import os from "node:os";

function log(line) {
  try {
    process.stdout.write(`${line}\n`);
  } catch {}
}

function logError(line) {
  try {
    process.stderr.write(`${line}\n`);
  } catch {}
}

const jarvisRoot = process.env.JARVIS_ROOT || import.meta.dirname;
const serverEntry = process.env.JARVIS_SERVER_ENTRY || path.join(jarvisRoot, "bundle", "index.js");

log(`[server-bootstrap] process started pid=${process.pid} platform=${process.platform} arch=${process.arch}`);
log(`[server-bootstrap] node=${process.version} jarvisHome=${process.env.JARVIS_HOME || "unset"}`);
log(`[server-bootstrap] root=${jarvisRoot}`);
log(`[server-bootstrap] entry=${serverEntry}`);

// V8 compile cache：把 bundle + external 依赖的 parse 产物缓存到磁盘，二次启动
// 跳过重新 parse（docs/SIZE_AND_STARTUP_OPT.md A1）。必须在 import server entry
// 之前启用。缓存落 JARVIS_HOME（随其清理策略走）；JARVIS_HOME 不可用时回退系统
// 临时目录；enableCompileCache 自身失败只降级为无缓存，绝不阻断启动。
const NODE_DISABLE_COMPILE_CACHE = process.env.NODE_DISABLE_COMPILE_CACHE === "1";
if (!NODE_DISABLE_COMPILE_CACHE && typeof enableCompileCache === "function") {
  try {
    const cacheDir = process.env.JARVIS_HOME
      ? path.join(process.env.JARVIS_HOME, "cache", "v8-compile")
      : path.join(os.tmpdir(), "jarvis-v8-compile-cache");
    const cacheStatus = enableCompileCache(cacheDir);
    log(`[server-bootstrap] compile cache dir=${cacheDir} status=${cacheStatus?.status ?? "unknown"}`);
  } catch (err) {
    log(`[server-bootstrap] compile cache unavailable: ${err?.message || err}`);
  }
}

const importStartedAt = Date.now();
const importTimer = setInterval(() => {
  const elapsedSec = Math.round((Date.now() - importStartedAt) / 1000);
  log(`[server-bootstrap] server entry import still pending after ${elapsedSec}s`);
}, 15000);
importTimer.unref?.();

// Independent keepalive thread.
//
// 主线程被 native module 加载（better-sqlite3 等）或重型 import 阻塞时，上面的
// setInterval 不会 fire，Electron 因 progress grace 用尽误判启动失败
// (#719 / #736 根因)。
//
// ⚠️ Worker 里 **必须** 用 `fs.writeSync(1, ...)` 直接写 stdout fd——绝不能用
// `process.stdout.write()`。Worker 的 stdout 默认走 MessagePort 转发到主线程的
// writable，主线程被阻塞时这些 message 会堆在主线程消息队列里，直到主线程恢复才
// 被一起 flush，keepalive 形同虚设。
//
// fs.writeSync(1, ...) 直接对父进程继承下来的 OS pipe fd 做 write() syscall，
// 不需要主线程参与；Worker 跑在独立 V8 isolate，自己的 event loop 不受主线程
// 影响，syscall 直达 Electron 端的 stdout pipe。
let keepaliveWorker = null;
try {
  keepaliveWorker = new Worker(
    "const fs = require('fs');"
    + "setInterval(() => { try { fs.writeSync(1, '[server-bootstrap] keepalive\\n'); } catch {} }, 5000);",
    { eval: true },
  );
  keepaliveWorker.on("error", (err) => {
    logError(`[server-bootstrap] keepalive worker error: ${err?.message || err}`);
  });
} catch (err) {
  logError(`[server-bootstrap] failed to start keepalive worker: ${err?.message || err}`);
}

try {
  log("[server-bootstrap] importing server entry");
  await import(pathToFileURL(serverEntry).href);
  // boot-summary（docs/SIZE_AND_STARTUP_OPT.md §8）：server entry 的 import
  // 段耗时——冷启动最大头（Defender 扫描 + V8 parse；A1 compile cache 只省
  // parse 段，扫描面靠 A2 依赖内联缩减）。
  log(`[server-bootstrap] server entry import completed in ${((Date.now() - importStartedAt) / 1000).toFixed(1)}s`);
} catch (err) {
  logError(`[server-bootstrap] failed to import server entry: ${err?.stack || err?.message || String(err)}`);
  process.exitCode = 1;
  throw err;
} finally {
  clearInterval(importTimer);
  if (keepaliveWorker) {
    keepaliveWorker.terminate().catch(() => {});
  }
}
