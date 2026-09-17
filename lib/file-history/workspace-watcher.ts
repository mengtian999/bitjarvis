// 工作区常驻递归监听：捕获绕过 ResourceIO 的写入（shell、桌面编辑器 IPC 直写、外部程序）。
// awaitWriteFinish 等文件稳定后再上报，避免读到写了一半的内容。
import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { isIgnoredRelPath } from "./text-file-policy.ts";

export type WorkspaceWatcher = {
  ready: Promise<void>;
  close: () => Promise<void>;
};

export function createWorkspaceWatcher({ root, onChanged, onDeleted, onError }: {
  root: string;
  onChanged: (relPath: string) => void;
  onDeleted: (relPath: string) => void;
  onError: (err: Error) => void;
}): WorkspaceWatcher {
  let resolvedRoot = root;
  try { resolvedRoot = fs.realpathSync(root); } catch { /* 不存在时保持原样，watch 会报错 */ }

  const toRel = (absPath: string): string | null => {
    const rel = path.relative(resolvedRoot, absPath);
    if (!rel || rel.startsWith("..")) return null;
    return rel.split(path.sep).join("/");
  };

  const watcher = chokidar.watch(resolvedRoot, {
    ignoreInitial: true,
    persistent: true,
    ignored: (absPath: string, stats?: fs.Stats) => {
      const rel = toRel(absPath);
      if (rel == null || rel === "") return false;
      // 目录：补尾斜杠使其落入策略函数的"目录段"判定，整棵剪枝
      if (stats?.isDirectory()) return isIgnoredRelPath(rel + "/");
      // 文件或 stats 未知：只按父目录段判定，绝不把末段当目录，
      // 避免误伤 .gitignore / .env 这类点开头文件（策略表明确要追踪它们）
      return isIgnoredRelPath(rel);
    },
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });

  const emitChanged = (absPath: string) => {
    const rel = toRel(absPath);
    if (rel) onChanged(rel);
  };
  const emitDeleted = (absPath: string) => {
    const rel = toRel(absPath);
    if (rel) onDeleted(rel);
  };

  watcher.on("add", emitChanged);
  watcher.on("change", emitChanged);
  watcher.on("unlink", emitDeleted);
  watcher.on("error", (err: unknown) => onError(err instanceof Error ? err : new Error(String(err))));

  const ready = new Promise<void>((resolve) => watcher.once("ready", () => resolve()));

  return {
    ready,
    close: () => watcher.close(),
  };
}
