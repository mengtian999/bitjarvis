/**
 * prompt-locale.ts — Agent prompt 语言的单一事实来源
 *
 * 背景：历史上 Agent 的所有 prompt 文案与人格模板都用 `isZh` 二元开关二分，
 * 第三种语言（ja / ko）只能拿到英文。本模块把「locale → prompt 语言」收敛成
 * 一个入口，任何模块都不得再自行写 `startsWith("zh")` 决定 prompt 语言。
 *
 * 三条纪律：
 *   1. UI locale 与 prompt 语言解耦：prompt 语言可以被用户单独覆盖
 *      （见 preferences.agent_prompt_locale），也可以因模型能力而回退。
 *   2. 未知一律乐观：没有证据表明模型不支持某语言时，按支持处理。
 *   3. 只决定「文案用哪种语言」，绝不约束模型内部 reasoning 语言。
 *
 * 详见 docs/AGENT_I18N.md §4。
 */

import path from "path";

export const PROMPT_LANGS = ["zh", "zh-TW", "ja", "ko", "fr", "de", "en"] as const;

export type PromptLang = (typeof PROMPT_LANGS)[number];

/** preferences.json 中的偏好键名 */
export const AGENT_PROMPT_LOCALE_PREF_KEY = "agent_prompt_locale";

/** "follow" = 跟随 Agent locale，并按模型能力回退 */
export const PROMPT_LOCALE_FOLLOW = "follow";

export const DEFAULT_AGENT_PROMPT_LOCALE = PROMPT_LOCALE_FOLLOW;

export type PromptLocaleOverride = typeof PROMPT_LOCALE_FOLLOW | PromptLang;

/**
 * 严格解析 locale → PromptLang。无法识别返回 null。
 *
 * 与 normalizePromptLang 的区别：这里不会把垃圾数据兜成 "en"，
 * 所以可以安全用于白名单校验（known-models.json 的 languages 字段）。
 */
export function parsePromptLang(value: unknown): PromptLang | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "zh-tw" || raw.startsWith("zh-hant")) return "zh-TW";
  if (raw === "zh" || raw.startsWith("zh-")) return "zh";
  if (raw === "ja" || raw.startsWith("ja-")) return "ja";
  if (raw === "ko" || raw.startsWith("ko-")) return "ko";
  if (raw === "fr" || raw.startsWith("fr-")) return "fr";
  if (raw === "de" || raw.startsWith("de-")) return "de";
  if (raw === "en" || raw.startsWith("en-")) return "en";
  return null;
}

/**
 * locale → PromptLang，未知/空值兜底 "en"。
 * 与改动前的 `isZh ? zh : en` 语义保持一致。
 */
export function normalizePromptLang(locale?: string | null): PromptLang {
  return parsePromptLang(locale) ?? "en";
}

/**
 * 归一化偏好值。返回 null 表示「没有有效覆盖」。
 */
export function normalizePromptLocaleOverride(value: unknown): PromptLocaleOverride | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (raw === PROMPT_LOCALE_FOLLOW) return PROMPT_LOCALE_FOLLOW;
  return parsePromptLang(raw);
}

/**
 * 归一化模型语言能力（known-models.json 的 languages 字段）。
 *
 * 返回 null 表示「未知」——调用方必须按「支持任意语言」处理，
 * 不能把 null 当成「什么都不支持」。
 */
export function normalizeModelLanguages(value: unknown): PromptLang[] | null {
  if (!Array.isArray(value)) return null;
  const out: PromptLang[] = [];
  for (const entry of value) {
    const lang = parsePromptLang(entry);
    if (lang && !out.includes(lang)) out.push(lang);
  }
  return out.length > 0 ? out : null;
}

/**
 * 模型是否支持某语言。
 * 能力未知（null / 空数组）时按支持处理；繁体可复用简体能力。
 */
export function modelSupportsPromptLang(
  languages: readonly string[] | null | undefined,
  lang: PromptLang,
): boolean {
  const supported = normalizeModelLanguages(languages);
  if (!supported) return true;
  if (supported.includes(lang)) return true;
  if (lang === "zh-TW" && supported.includes("zh")) return true;
  return false;
}

/**
 * 模型不支持目标语言时，挑一个可用语言。优先英文。
 */
export function resolveSupportedPromptLang(
  languages: readonly string[] | null | undefined,
  requested: PromptLang,
): PromptLang {
  const supported = normalizeModelLanguages(languages);
  if (!supported) return requested;
  if (supported.includes(requested)) return requested;
  if (requested === "zh-TW" && supported.includes("zh")) return requested;
  const fallbackOrder: readonly PromptLang[] = ["en", "zh", "ja", "ko", "fr", "de"];
  for (const candidate of fallbackOrder) {
    if (supported.includes(candidate)) return candidate;
  }
  return "en";
}

export interface PromptLocaleInput {
  /** Agent.resolveLocale()：config.locale → 全局 preferences.locale → "en" */
  agentLocale?: string | null;
  /** preferences.agent_prompt_locale；"follow" 或具体语言 */
  override?: string | null;
  /** 模型语言能力；null = 未知（按支持处理） */
  modelLanguages?: readonly string[] | null;
}

export interface PromptLocaleResult {
  lang: PromptLang;
  /** true 表示因模型能力不足发生了回退 */
  fallback: boolean;
  reason: "override" | "agent-locale" | "model-unsupported" | "default";
}

/**
 * 解析链：用户覆盖 → Agent locale → 模型能力过滤 → 兜底 en。
 * 见 docs/AGENT_I18N.md §4.1。
 */
export function resolvePromptLang(input: PromptLocaleInput = {}): PromptLocaleResult {
  const override = normalizePromptLocaleOverride(input.override);
  if (override && override !== PROMPT_LOCALE_FOLLOW) {
    // 用户显式指定：跳过一切能力检测，由用户负责
    return { lang: override, fallback: false, reason: "override" };
  }

  const hasAgentLocale = typeof input.agentLocale === "string" && input.agentLocale.trim().length > 0;
  if (!hasAgentLocale) {
    return { lang: "en", fallback: false, reason: "default" };
  }

  const requested = normalizePromptLang(input.agentLocale);
  const resolved = resolveSupportedPromptLang(input.modelLanguages, requested);
  if (resolved !== requested) {
    return { lang: resolved, fallback: true, reason: "model-unsupported" };
  }
  return { lang: requested, fallback: false, reason: "agent-locale" };
}

/**
 * 模板子目录：zh / zh-TW → ""（根目录即中文模板）；其余 → "ja/" 等。
 */
export function promptLangDir(lang: PromptLang): string {
  return lang === "zh" || lang === "zh-TW" ? "" : `${lang}/`;
}

/**
 * 模板定位。顺序固定为：
 *   - zh / zh-TW：根目录(中文) → en/
 *   - 其余语言：  {lang}/ → en/ → 根目录(中文)
 *
 * 必须以**文件存在性**判断，不能用「内容非空」：`lib/yuan/kong.md` 本身就是
 * 接近空的模板，用内容判断会把它当成缺失，从而错误回落到中文。
 *
 * @param baseDir  模板根目录，如 `<productDir>/identity-templates`
 * @param fileName 模板文件名，如 `jarvis.md`
 * @param exists   文件存在性判定（生产用 fs.existsSync，测试可注入）
 * @returns 命中的绝对路径；全缺失返回 null
 */
export function resolveTemplatePath(
  baseDir: string,
  fileName: string,
  lang: PromptLang,
  exists: (absPath: string) => boolean,
): string | null {
  const rootTemplate = path.join(baseDir, fileName);
  const englishTemplate = path.join(baseDir, "en", fileName);
  const langDir = promptLangDir(lang);
  const candidates: string[] = [];

  if (langDir) {
    candidates.push(path.join(baseDir, langDir, fileName));
  } else {
    // 中文与繁体中文：根目录就是它们自己的模板
    candidates.push(rootTemplate);
  }
  // 英文是全局兜底语言，永远排在根目录（中文）之前，避免第三语言掉进中文
  candidates.push(englishTemplate);
  candidates.push(rootTemplate);

  for (const candidate of new Set(candidates)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export type PromptTextTable = Partial<Record<PromptLang, string>> & { en: string };

/**
 * 按语言取文案。缺失回退 en；繁体优先回退 zh 再回退 en。
 */
export function pickPromptText(lang: PromptLang, table: PromptTextTable): string {
  if (lang === "zh-TW") return table["zh-TW"] ?? table.zh ?? table.en;
  return table[lang] ?? table.en;
}