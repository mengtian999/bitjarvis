import fs from "fs";
import path from "path";
import { normalizePromptLang, pickPromptText } from "../shared/prompt-locale.ts";

const WORKSPACE_INSTRUCTION_FILES = [
  { filename: "AGENTS.md", key: "inject_agents_md" },
  { filename: "CLAUDE.md", key: "inject_claude_md" },
];

function normalizeComparePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(a, b) {
  return normalizeComparePath(a) === normalizeComparePath(b);
}

function existingDirectory(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return null;
  try {
    const resolved = path.resolve(rawPath);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return resolved;
    if (stat.isFile()) return path.dirname(resolved);
    return null;
  } catch {
    return null;
  }
}

function findGitRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    try {
      if (fs.existsSync(path.join(current, ".git"))) return current;
    } catch {
      return null;
    }
    const parent = path.dirname(current);
    if (samePath(parent, current)) return null;
    current = parent;
  }
}

function directoriesFromRootToCwd(rootDir, cwd) {
  const dirs = [];
  let current = path.resolve(cwd);
  while (true) {
    dirs.unshift(current);
    if (samePath(current, rootDir)) break;
    const parent = path.dirname(current);
    if (samePath(parent, current)) return [];
    current = parent;
  }
  return dirs;
}

function readInstructionFile(filePath) {
  try {
    return { content: fs.readFileSync(filePath, "utf-8") };
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    return { error: err?.message || String(err) };
  }
}

export function collectWorkspaceInstructionFiles({ cwd, workspaceContext }: { cwd?: any; workspaceContext?: any } = {}) {
  const enabled = new Set();
  const config = workspaceContext && typeof workspaceContext === "object" ? workspaceContext : {};
  for (const item of WORKSPACE_INSTRUCTION_FILES) {
    if (config[item.key] === true) enabled.add(item.filename);
  }
  if (enabled.size === 0) return [];

  const startDir = existingDirectory(cwd);
  if (!startDir) return [];

  const gitRoot = findGitRoot(startDir);
  const searchRoot = gitRoot || startDir;
  const dirs = directoriesFromRootToCwd(searchRoot, startDir);
  const files = [];
  for (const dir of dirs) {
    for (const item of WORKSPACE_INSTRUCTION_FILES) {
      if (!enabled.has(item.filename)) continue;
      const filePath = path.join(dir, item.filename);
      const result = readInstructionFile(filePath);
      if (!result) continue;
      files.push({
        path: filePath,
        filename: item.filename,
        ...result,
      });
    }
  }
  return files;
}

export function formatWorkspaceInstructionFiles(files: any, { locale }: { locale?: any } = {}) {
  const items = Array.isArray(files) ? files : [];
  if (items.length === 0) return "";
  const lang = normalizePromptLang(String(locale || ""));
  const body = items.map((file) => {
    const content = typeof file.content === "string"
      ? file.content.trim()
      : pickPromptText(lang, {
          zh: `无法读取该文件：${file.error || "未知错误"}`,
          ja: `このファイルを読み取れませんでした：${file.error || "不明なエラー"}`,
          ko: `이 파일을 읽을 수 없습니다: ${file.error || "알 수 없는 오류"}`,
          fr: `Impossible de lire ce fichier : ${file.error || "erreur inconnue"}`,
          de: `Diese Datei konnte nicht gelesen werden: ${file.error || "unbekannter Fehler"}`,
          en: `Could not read this file: ${file.error || "unknown error"}`,
        });
    return [
      `### ${file.filename || path.basename(file.path || "")}`,
      file.path ? `Path: ${file.path}` : "",
      "",
      content,
    ].filter((line, index) => index !== 1 || line).join("\n");
  }).join("\n\n");

  return pickPromptText(lang, {
    zh: `\n## 工作区说明\n\n以下内容来自主工作台目录链路中的 AGENTS.md / CLAUDE.md。它们是项目级工作规则，只对当前工作区上下文生效。\n\n${body}`,
    ja: `\n## ワークスペース指示\n\n以下の内容は、メインワークベンチのディレクトリ連鎖にある AGENTS.md / CLAUDE.md から取得したものです。これらはプロジェクトレベルの作業ルールであり、現在のワークスペースコンテキストにのみ適用されます。\n\n${body}`,
    ko: `\n## 워크스페이스 지침\n\n다음 내용은 메인 워크벤치 디렉터리 체인의 AGENTS.md / CLAUDE.md에서 가져온 것입니다. 이것들은 프로젝트 수준의 작업 규칙이며, 현재 워크스페이스 컨텍스트에만 적용됩니다.\n\n${body}`,
    fr: `\n## Instructions de l'espace de travail\n\nLe contenu suivant provient des fichiers AGENTS.md / CLAUDE.md de la chaîne de répertoires du plan de travail principal. Considérez-les comme des règles de travail au niveau projet pour ce contexte d'espace de travail.\n\n${body}`,
    de: `\n## Arbeitsbereichsanweisungen\n\nDer folgende Inhalt stammt aus AGENTS.md / CLAUDE.md-Dateien in der Verzeichniskette des primären Arbeitsplatzes. Betrachte sie als projektbezogene Arbeitsregeln für diesen Arbeitsbereichskontext.\n\n${body}`,
    en: `\n## Workspace Instructions\n\nThe following content comes from AGENTS.md / CLAUDE.md files in the primary workbench's directory chain. Treat them as project-level working rules for this workspace context.\n\n${body}`,
  });
}

export function buildWorkspaceInstructionPrompt({ cwd, workspaceContext, locale }: { cwd?: string; workspaceContext?: unknown; locale?: string } = {}) {
  return formatWorkspaceInstructionFiles(
    collectWorkspaceInstructionFiles({ cwd, workspaceContext }),
    { locale },
  );
}
