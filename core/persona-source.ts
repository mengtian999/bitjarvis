/**
 * persona-source.ts — identity.md / ishiki.md 的统一回落链（惰性材料化）
 *
 * 人格模板不再在创建 agent 时落盘：agentDir 里没有 identity.md / ishiki.md
 * 时，运行时按当前 locale 现选 lib 模板；用户在设置页编辑保存后才真正落盘
 * （落盘 = 用户显式定制）。这份回落链必须是全仓唯一实现——runtime system
 * prompt 组装（core/agent.ts）、GET 路由（server/routes/agents.ts、
 * server/routes/config.ts）、花名册摘要（core/agent-manager.ts）、角色卡导出
 * （lib/character-cards/service.ts）、设置快照（server/routes/settings-snapshot.ts）
 * 全部消费这一份实现，禁止各自复制回落顺序，否则多份拷贝会在未来某次模板
 * 改名/加语言时悄悄漂移。
 *
 * 回落顺序（与改动前 core/agent.ts personality getter 逐字节等价）：
 *   1. agentDir 下的落盘文件（用户定制内容）
 *   2. 该 yuan 的语言专属模板（identity-templates/en/xxx.md 等）
 *   3. 该 yuan 的通用模板（不分语言）
 *   4. 通用 example 兜底（identity.example.md / ishiki.example.md）
 */

import path from "path";
import { safeReadFile } from "../shared/safe-fs.ts";

export type PersonaKind = "identity" | "ishiki";

export interface PersonaSourceResult {
  content: string;
  /** true = 内容来自模板回落（agentDir 没有落盘文件）；false = 用户已定制落盘 */
  fromTemplate: boolean;
}

export interface ResolvePersonaSourceArgs {
  agentDir: string;
  productDir: string;
  yuanType: string;
  locale: string;
  kind: PersonaKind;
}

const KIND_CONFIG: Record<PersonaKind, { fileName: string; templateDir: string; exampleFile: string }> = {
  identity: {
    fileName: "identity.md",
    templateDir: "identity-templates",
    exampleFile: "identity.example.md",
  },
  ishiki: {
    fileName: "ishiki.md",
    templateDir: "ishiki-templates",
    exampleFile: "ishiki.example.md",
  },
};

export function resolvePersonaSource({
  agentDir,
  productDir,
  yuanType,
  locale,
  kind,
}: ResolvePersonaSourceArgs): PersonaSourceResult {
  const { fileName, templateDir, exampleFile } = KIND_CONFIG[kind];
  const isZh = String(locale).startsWith("zh");
  const langDir = isZh ? "" : "en/";
  const readFile = (p: string) => safeReadFile(p, "");

  const own = readFile(path.join(agentDir, fileName));
  if (own) return { content: own, fromTemplate: false };

  const langTemplate = readFile(path.join(productDir, templateDir, `${langDir}${yuanType}.md`));
  if (langTemplate) return { content: langTemplate, fromTemplate: true };

  const genericTemplate = readFile(path.join(productDir, templateDir, `${yuanType}.md`));
  if (genericTemplate) return { content: genericTemplate, fromTemplate: true };

  const example = readFile(path.join(productDir, exampleFile));
  return { content: example, fromTemplate: true };
}

/**
 * 没有 Agent 实例时（花名册扫描、导出、快照等场景，agent 可能尚未加载进
 * engine 内存）解析 locale：与 Agent.resolveLocale() 同一条链——agent 自身
 * config.yaml 的 locale 显式值优先，缺失时落全局 prefs 的 locale，两级都缺
 * 落 "en"。
 */
export function resolvePersonaLocale(configLocale: unknown, globalLocale: unknown): string {
  const explicit = typeof configLocale === "string" ? configLocale.trim() : "";
  if (explicit) return explicit;
  const global_ = typeof globalLocale === "string" ? globalLocale.trim() : "";
  if (global_) return global_;
  return "en";
}
