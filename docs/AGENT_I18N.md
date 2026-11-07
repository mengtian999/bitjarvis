# Agent 多语言（fr / de / ja / ko）母语化开发方案

> 状态：P0-P3 已完成（含语音 fr/de 补齐），整体仅剩母语审校与 whisper 模型 URL 实测 ｜ 版本：v1.7 ｜ 最后更新：2026-11-06

本文是 Agent 层多语言化的唯一实施方案。它回答三件事：现状到底缺什么、改哪些代码、做完怎么验证。

范围限定在 **Agent 的指令层与人格层**（system prompt、人格模板、记忆/日记/工具类 prompt）。UI 文案、语音、插件内容不在本文范围内，见 §1.3。

## 目录

| 章节 | 内容 |
|---|---|
| §1 | 背景与目标（现状、目标、非目标） |
| §2 | 现状调研（量化数据、三个隐患 H1-H3） |
| §3 | 关键设计决策 D1-D5 |
| §4 | 目标架构（解析链、新模块、数据模型、新偏好） |
| §5 | 详细改动清单（A 基础设施 / B Agent 核心 / C 相邻模块 / D 资源 / E UI / F 元数据 / G 测试） |
| §6 | 分阶段实施计划 P0-P3 与里程碑 |
| §7 | 工作量与成本结构 |
| §8 | 测试方案 |
| §9 | 验收标准（DoD） |
| §10 | 风险与回滚 |
| §11 | 待确认事项 |
| §12 | 附录（文件索引、47 处核对、变更记录） |

### 实施进度

| 阶段 | 状态 | 交付 |
|---|---|---|
| P0 基础设施 | ✅ 已完成 | `shared/prompt-locale.ts`、H1 兜底修复、fr/de 路由、`agent_prompt_locale` 偏好、`languages` 透传骨架、G5/G6 测试 |
| P1 ja / ko 母语化 | ✅ 代码与资产完成 | B/C1/C2 批 + ja/ko 文案包 + 26 个模板（含 yuan 8 个）+ G7/G8/G9/G10 测试；仅剩 ja/ko 母语审校 |
| P2 fr / de 全量 | ✅ 已完成 | D2 fr/de JSON（2989 键 0 缺失）+ E1/E2/E3 + G1-G4 + C1/C2 全量文案表 + 大型 prompt fr/de 全文 + D1 模板 26 文件 + FR/DE Agent 文案包 + C3 收敛 |
| P3 能力感知与覆盖 | 🟡 主体完成 | F1 languages 策展 231 模型 + F2 三态语义注释 + F4 FIELD_MAP 禁注 + F5 校验脚本（npm run validate:languages）+ E4/E5 agent_prompt_locale 设置项与 UI 下拉 + 能力回退测试矩阵；heartbeat fr/de 文案留 P3 尾项 |

---

## 1. 背景与目标

### 1.1 现状：UI 五语种，Agent 只有两语种

UI 侧已经支持 `zh / zh-TW / ja / ko / en`，但 Agent 的"大脑层"只有一个二元开关：

```ts
// core/agent.ts:1261
const isZh = String(this.resolveLocale()).startsWith("zh");
```

所有 prompt 段落、人格模板选择都挂在 `isZh` 上，实际语义是：

| 用户 locale | UI 语言 | Agent prompt 语言 | Agent 人格模板 |
|---|---|---|---|
| `zh` / `zh-CN` | 中文 | 中文 | 中文（模板根目录） |
| `zh-TW` | 繁体中文 | 中文 | 中文（模板根目录） |
| `ja` | 日语 | **英文** | **英文**（`en/`） |
| `ko` | 韩语 | **英文** | **英文**（`en/`） |
| `en` | 英文 | 英文 | 英文（`en/`） |

`core/agent.ts:274-277` 的注释把这件事写成了有意取舍：

> 各读点仍用 `.startsWith("zh")` 做模板二分：locale 以 `zh` 开头 → zh 模板，其余一切语言 → en 模板。第三语言 UI 用户拿到英文 prompt 模板是有意的设计取舍，不是 bug。

这个取舍对 ja/ko 造成了两个可见后果：界面是日语/韩语，助手却用英文说话；人格与语气被英文化，与日韩用户对敬语、高语境表达的预期不符。

### 1.2 目标

1. Agent 指令层与人格层支持 `zh / zh-TW / ja / ko / fr / de / en` 七个语言
2. 引入**模型语言能力感知**：模型被标注为不支持目标语言时，自动回退到它可靠的语言（默认 `en`）
3. 提供**用户覆盖**：新增「Agent 提示语言」偏好，用户可强制指定，优先级最高
4. **可回滚**：所有新行为都能通过一个偏好开关退回今天的二元行为，不需要发版

### 1.3 非目标

| 项 | 原因 |
|---|---|
| 强制模型用某语言做内部 reasoning / CoT | 英文 CoT 质量普遍更优（尤其推理模型与小参数模型），强制母语思考是负优化 |
| 语音 TTS / ASR 的 fr、de 支持 | ~~原列非目标~~ **已于 v1.7 补齐**（EDGE-TTS 七语种全支持 + fr 走 kokoro(ff_siwis)、fr/de ASR 走 whisper-base 按需下载；见 §12.10） |
| 第三方 skill / plugin 内容翻译 | 由插件作者负责，不在平台层 |
| zh-TW 独立人格模板 | 延续复用 zh 模板，仅 UI 繁体；若后续需要，见 §11 |

---

## 2. 现状调研结论

### 2.1 量化数据

| 项目 | 实测值 | 位置 |
|---|---|---|
| UI locale 叶子键数 | **2994 键 / locale**，5 个 locale 完全对齐 | `desktop/src/locales/*.json` |
| Agent 内 `isZh` 引用 | **34 处** | `core/agent.ts` |
| 全仓 `startsWith("zh")` | **28 个文件 / 47 处** | `core/` + `lib/` |
| 人格模板资产 | **26 文件 / 32,806 字节** | `lib/{yuan,identity-templates,ishiki-templates,public-ishiki-templates}/` |
| 模型元数据 | **937 条模型**，无任何语言能力字段 | `lib/known-models.json` |

模板资产明细：

| 目录 | 中文（根） | 英文（`en/`） | 单文件均 |
|---|---|---|---|
| `lib/yuan/` | `jarvis` `butter` `kong` `ming` | 同名 4 个 | ~2.5 KB（`kong` 实际为空） |
| `lib/identity-templates/` | `jarvis` `butter` `ming` | 同名 3 个 | ~100 B |
| `lib/ishiki-templates/` | 同上 3 个 | 同名 3 个 | ~1 KB |
| `lib/public-ishiki-templates/` | 同上 3 个 | 同名 3 个 | ~1.6 KB |

### 2.2 三个必须先修的隐患

以下三个问题在现状下不会暴露，但一旦加入 fr / de 就会立刻变成生产事故。

#### H1 — 模板兜底会掉进中文（严重）

```ts
// core/persona-source.ts:60-71
const langDir = isZh ? "" : "en/";
readFile(path.join(productDir, templateDir, `${langDir}${yuanType}.md`))   // ① 语言模板
  || readFile(path.join(productDir, templateDir, `${yuanType}.md`))        // ② 通用模板 = 中文
```

今天 ja / ko 走 `langDir = "en/"`，且 `en/` 目录存在，所以没问题。**但 fr / de 若只加 locale JSON 而不建 `fr/`、`de/` 模板目录，① 会读到空串，直接落到 ② 的中文模板** —— 法语用户的人格会变成中文。

同样的写法出现在：

| 位置 | 函数 |
|---|---|
| `core/agent.ts:1166-1169` | `_readYuan()` |
| `core/agent.ts:1180-1185` | `_readPublicIshiki()` |
| `core/agent-manager.ts:699` | 创建 agent 时的模板播种 |
| `core/first-run.ts:228` | 首启默认 agent 播种 |

**修复要求**：兜底顺序改为 `{lang}/ → en/ → 根目录(中文)`，且以**文件存在性**判断，不能用"内容非空"判断（`lib/yuan/kong.md` 本身接近空文件）。

#### H2 — 服务端 i18n 会把 fr / de 当英文

```ts
// lib/i18n.ts:22-29（desktop/src/lib/i18n.js:100-107 同构）
if (locale.startsWith("ja")) return "ja";
if (locale.startsWith("ko")) return "ko";
return "en";           // ← fr / de 全部落到 en
```

服务端 `t()` 读取的就是这套映射，所以不补分支的话，法语界面下所有服务端生成的文案（默认频道名、错误提示、工具状态）都会是英文。

#### H3 — 无法判断模型语言能力

`lib/known-models.json` 的 937 条模型，字段只有：

```
api, audio, compat, context, defaultThinkingLevel, image, legacyCompatibility,
maxContext, maxOutput, name, quirks, reasoning, thinkingLevelMap,
thinkingLevels, toolUse, type, video, visionCapabilities, xhigh
```

`scripts/sync-known-models-from-pi.mjs:41-62` 的白名单也只有 `context / maxOutput / image / reasoning` 四个字段。

结论：**平台当前没有任何数据能支撑"这个模型不支持德语"的判断**。要做能力回退，必须先扩展数据模型。

---

## 3. 关键设计决策

| ID | 决策 | 理由 | 放弃的备选 |
|---|---|---|---|
| **D1** | 废除二值 `isZh`，新增单一模块 `shared/prompt-locale.ts` 统一解析 | 47 处散落二元分支无法维护，多语言下必然漂移；单一事实来源才能保证一致性 | 逐文件把 `isZh` 改成五元三元表达式 → 分支爆炸、无法收敛 |
| **D2** | **UI locale 与 Agent prompt 语言解耦**，引入 `agent_prompt_locale` 偏好 | 用户可能界面用日文、但所接模型只擅长英文；解耦后两者可以独立决策 | 直接复用 `locale` → 无法覆盖、无法回退 |
| **D3** | 模型语言能力采用**三态**：已知支持 / 未知（按支持处理）/ 已知不支持 | 全量策展 937 条不现实；主流模型默认可用，只对明显单语的模型显式收窄 | 全量策展 → 3~5 人天且长期维护负担；完全不检测 → 小模型用户受伤 |
| **D4** | **不约束 CoT 语言**，prompt 内绝不出现"请用 X 语言思考" | 现有实现只换文案不约束推理语言，这一点是对的，必须保持 | 强制母语思考 → 推理质量下降，且无法验证 |
| **D5** | 模板目录约定改为「根 = 默认中文 / `{lang}/` = 各语言」，兜底显式插入 `en/` | 兼容存量中文与 `en/` 资产，无需迁移任何文件 | 重构为 `{lang}/` 全量目录 → 需迁移全部存量文件 |

---

## 4. 目标架构

### 4.1 解析链

```
┌─ ① 用户强制覆盖（preferences.agent_prompt_locale ≠ "follow"）
│      直接采用；跳过能力检测（用户自己负责）
│
├─ ② Agent locale（config.locale → 全局 preferences.locale → "en"）
│      沿用现有 Agent.resolveLocale()，语义不变
│
├─ ③ 模型语言能力过滤（lib/known-models.json 的 languages[]）
│      已知不含目标语言 → 回退模型支持的首选语言（优先 en）
│
└─ ④ 资源兜底（模板按文件存在性 / JSON 按 en 兜底）
       zh / zh-TW： 根 x.md(中文) → en/x.md → example
       其余语言：   {lang}/x.md → en/x.md → 根 x.md(中文) → example
```

> 注意：`en/` 必须排在"根目录（中文）"之前。否则缺少语言模板的 fr/de 用户会
> 静默拿到中文人格（§2.2 H1）。zh / zh-TW 的根目录就是它们自己的模板，因此
> 它们先查根目录。

关键点：第 ③ 步只影响"用哪种语言的 prompt 文案"，不改变会话内容语言、不改变推理语言。

### 4.2 新增模块 `shared/prompt-locale.ts`

这是全仓唯一允许做 locale → prompt 语言判定的地方。所有消费方（`core/agent.ts`、`core/persona-source.ts`、记忆/日记模块、`lib/i18n.ts`）都必须经过它。

```ts
export const PROMPT_LANGS = ["zh", "zh-TW", "ja", "ko", "fr", "de", "en"] as const;
export type PromptLang = (typeof PROMPT_LANGS)[number];

export const PROMPT_LOCALE_FOLLOW = "follow";
export type PromptLocaleOverride = typeof PROMPT_LOCALE_FOLLOW | PromptLang;

/** 未知/空值 → "en"（沿用现有行为） */
export function normalizePromptLang(locale?: string | null): PromptLang;

/** 严格解析：未知返回 null，用于白名单场景（不会被垃圾数据污染成 en） */
export function parsePromptLang(value: unknown): PromptLang | null;

/** 归一化模型 languages 字段；非数组/空数组 → null（= 未知） */
export function normalizeModelLanguages(value: unknown): string[] | null;

/** 未知（null/空）按"支持"处理 */
export function modelSupportsPromptLang(
  languages: readonly string[] | null | undefined,
  lang: PromptLang,
): boolean;

/** 不支持时挑一个可用语言，优先 en */
export function resolveSupportedPromptLang(
  languages: readonly string[] | null | undefined,
  requested: PromptLang,
): PromptLang;

export interface PromptLocaleInput {
  agentLocale?: string | null;
  override?: string | null;
  modelLanguages?: readonly string[] | null;
}

export interface PromptLocaleResult {
  lang: PromptLang;
  fallback: boolean;
  reason: "override" | "agent-locale" | "model-unsupported" | "default";
}

export function resolvePromptLang(input?: PromptLocaleInput): PromptLocaleResult;

/** zh / zh-TW → ""（复用根目录中文模板）；其余 → "ja/" 等 */
export function promptLangDir(lang: PromptLang): string;

/** H1 修复核心：按存在性排序候选（en/ 永远早于根目录；zh/zh-TW 根目录优先） */
export function resolveTemplatePath(
  baseDir: string,
  fileName: string,
  lang: PromptLang,
  exists: (absPath: string) => boolean,
): string | null;

/** C 组批量改造用：按语言取文案，缺失回退 en（zh-TW 回退 zh） */
export type PromptTextTable = Partial<Record<PromptLang, string>> & { en: string };
export function pickPromptText(lang: PromptLang, table: PromptTextTable): string;
```

`pickPromptText` 的回退链固定为：`lang → en`，其中 `zh-TW → zh → en`。

### 4.3 模型语言能力数据模型

在 `lib/known-models.json` 的**模型条目**上新增可选字段 `languages`（与 `image` / `reasoning` 同级）：

```jsonc
{
  "qwen": {
    "qwen-max": {
      "name": "Qwen Max",
      "context": 131072,
      "languages": ["zh", "en", "ja", "ko", "fr", "de"]
    },
    "qwen2.5-1.5b-instruct": {
      "name": "Qwen2.5 1.5B Instruct",
      "languages": ["zh", "en"]
    }
  }
}
```

语义约定（必须写进 `lib/known-models.json` 的 `_comment`）：

| 取值 | 含义 | 解析行为 |
|---|---|---|
| 字段缺失 | 未知 | 按支持任意语言处理（乐观默认） |
| `["en"]` | 单语 | 非 en 一律回退 en |
| `["zh","en"]` | 中英 | ja / ko / fr / de 回退 en |
| 含目标语言 | 支持 | 正常使用该语言 |

注意：`scripts/sync-known-models-from-pi.mjs` 的 `FIELD_MAP` **不得**加入 `languages`，避免人工策展值被上游 models.dev 覆盖。

### 4.4 新增全局偏好

```jsonc
// preferences.json
{ "agent_prompt_locale": "follow" }   // "follow" | "zh" | "zh-TW" | "ja" | "ko" | "fr" | "de" | "en"
```

- 默认 `follow`：跟随 Agent locale，并接受模型能力回退
- 显式指定语言：忽略 Agent locale 与模型能力，完全按用户选择

---

## 5. 详细改动清单

标注说明：**新增** = 新文件；其余为修改既有文件。

### 5.1 A 组 — 基础设施（P0，阻塞项）

| # | 文件 | 改动 | 位置 |
|---|---|---|---|
| A1 | `shared/prompt-locale.ts` | **新增**，实现 §4.2 全部导出 | 新文件 |
| A2 | `lib/i18n.ts` | `resolveKey()` 增加 `fr` / `de` 分支 | `:22-29` |
| A3 | `desktop/src/lib/i18n.js` | `_resolveKey()` 增加 `fr` / `de` 分支 | `:100-107` |
| A4 | `core/persona-source.ts` | 用 `resolveTemplatePath` 替换硬编码 `langDir`，兜底改 `{lang} → en → 根 → example`，存在性用 `fs.existsSync` | `:52-75` |
| A5 | `shared/known-models.ts` | 新增 `lookupModelLanguages(provider, modelId): string[] \| null` | 追加导出 |
| A6 | `core/model-known-enrichment.ts` | `languages` 透传进 `patch`（与 `visionCapabilities` 同款写法） | `:109-114` |
| A7 | `core/model-sync.ts` | `buildModelOverride()` 与 `buildModelEntry()` 各透传一次 `languages` | `:210-217`、`:327-332` |
| A8 | `shared/config-schema.ts` | 新增 `agent_prompt_locale`（global，setter/getter，默认 `follow`） | `:23` 之后 |
| A9 | `core/preferences-manager.ts` | 新增 `getAgentPromptLocale()` / `setAgentPromptLocale(v)` | `:517` 之后 |
| A10 | `core/engine.ts` | 暴露 `getAgentPromptLocale` / `setAgentPromptLocale` 转发到 prefs | `:2008` 之后 |
| A11 | `core/agent-manager.ts` | 构造 agent `_cb` 时注入 `getAgentPromptLocale` 与 `getModelLanguages` | `:1184-1187`（`getLocale/getUserName` 旁） |

> A11 是 P0 与 P1 的接缝：`Agent` 通过 `_cb` 取全局偏好与模型语言能力，避免直接依赖 engine 实例。若 P0 暂不接，P1 必须补。

### 5.2 B 组 — Agent 核心（P1）

新增两个文件：

- `core/agent-prompt-text.ts`：`AGENT_PROMPT_TEXT: Record<PromptLang, Record<string, string>>`，承载 system prompt 的所有段落文案
- `core/agent-prompt-locale.ts`（可选）：`Agent._promptLang()` 的独立实现，便于单测

`core/agent.ts` 内部改造方式：

```ts
// 替换所有 const isZh = ...
_promptLang(): PromptLang {
  return resolvePromptLang({
    agentLocale: this.resolveLocale(),
    override: this._cb?.getAgentPromptLocale?.(),
    modelLanguages: this._cb?.getModelLanguages?.(this._config?.models?.chat),
  }).lang;
}
```

34 处 `isZh` 的逐点对应：

| # | 行号 | 现状 | 改法 |
|---|---|---|---|
| B1 | `:275` | 注释描述二元语义 | 重写注释，指向 §4.1 |
| B2 | `:299` | `resolveUserName()` 的 `"用户"/"User"` | `pickPromptText(lang, { zh:"用户", ja:"ユーザー", ko:"사용자", fr:"Utilisateur", de:"Benutzer", en:"User" })` |
| B3 | `:1166-1169` | `_readYuan()` 的 `langDir` | `resolveTemplatePath(yuan 目录, ...)`，改用 `fs.existsSync` |
| B4 | `:1180-1185` | `_readPublicIshiki()` 的 `langDir` | 同上 |
| B5 | `:1189-1202` | `_formatTeamRoster(isZh)` | 形参改为 `lang`；`"（你）"/"(you)"` 走文案表 |
| B6 | `:1212,1221,1224` | `buildMemoryReflectionSnapshot()` 三段标题 | 文案表 |
| B7 | `:1261` | `buildSystemPrompt()` 的 `isZh` | `this._promptLang()` |
| B8 | `:1293-1314` | 执行环境段落 | 文案表 |
| B9 | `:1322` | `# 用户档案` / `# User Profile` | 文案表 |
| B10 | `:1338-1341` | 输出约束段 | 文案表 |
| B11 | `:1348-1366` | 记忆使用规则（4 条长文案） | 文案表 |
| B12 | `:1377-1389` | 置顶记忆 / 记忆 section 标题与引导 | 文案表 |
| B13 | `:1400-1409` | 工具使用纪律 | 文案表 |
| B14 | `:1411-1426` | Session 文件与交付 | 文案表 |
| B15 | `:1428-1434` | 可见 UI 上下文 | 文案表 |
| B16 | `:1446/1463/1476/1486` | 安全 / 设置 / 网页搜索策略等 4 段 | 文案表 |
| B17 | `:1497-1508` | 主动技能获取 | 文案表 |
| B18 | `:1514-1527` | 团队协作 | 文案表 |
| B19 | `:1551/1554` | Session 开始时间提示 | 文案表 |

其余 B 组文件：

| # | 文件 | 行号 | 改动 |
|---|---|---|---|
| B20 | `core/agent-manager.ts` | `:111` | locale 归一化改用 `normalizePromptLang` |
| B21 | `core/agent-manager.ts` | `:699` | 模板目录改用 `promptLangDir` + `resolveTemplatePath` |
| B22 | `core/first-run.ts` | `:228` | 首启模板选择同上 |

> 文案表结构建议按段落命名（`userProfile` / `memoryRules` / `toolDiscipline` / `sessionFiles` / …），避免在调用点拼长字符串。

### 5.3 C 组 — Agent 相邻模块（P1 / P2）

按"是否影响用户可见输出"分三批。C1、C2 必须母语化；C3 允许先用英文占位并打 `TODO` 标记。

**C1 批 — Agent 输出与人格直接相关（P1）**

| 文件 | 处数 | 行号 |
|---|---|---|
| `core/llm-utils.ts` | 7 | `195, 220, 284, 318, 407, 507, 584` |
| `core/session-coordinator.ts` | 2 | `779, 6079` |
| `core/workspace-instruction-files.ts` | 1 | `101` |
| `core/provider-prompt-patches.ts` | 1 | `16` |
| `core/vision-prepare.ts` | 1 | `32` |
| `lib/agent-appearance-summary.ts` | 1 | `127` |
| `lib/bridge/bridge-context.ts` | 1 | `27` |
| `lib/channels/channel-store.ts` | 1 | `527` |
| `lib/tools/install-skill.ts` | 1 | `84` |
| `lib/tools/web-search.ts` | 1 | `119` |
| **小计** | **17 处 / 10 文件** | |

**C2 批 — 记忆与日记（P1）**

| 文件 | 处数 | 行号 |
|---|---|---|
| `lib/memory/prompts/compile.ts` | 4 | `2, 57, 102, 155` |
| `lib/diary/diary-writer.ts` | 4 | `35, 134, 358, 616` |
| `lib/memory/session-summary.ts` | 2 | `341, 772` |
| `lib/memory/compile.ts` | 1 | `51` |
| `lib/memory/deep-memory.ts` | 1 | `259` |
| `lib/memory/memory-reflection-runner.ts` | 1 | `17` |
| `lib/memory/rolling-summary-format.ts` | 1 | `59` |
| `lib/memory/prompts/fact-extraction.ts` | 1 | `2` |
| `lib/memory/prompts/rolling-summary.ts` | 1 | `16` |
| **小计** | **16 处 / 9 文件** | |

**C3 批 — 边缘与调试类（P2，可英文占位）**

| 文件 | 行号 | 说明 |
|---|---|---|
| `core/provider-compat/deepseek.ts` | `186` | provider 兼容文案 |
| `core/slash-commands/rc-summary.ts` | `48` | 斜杠命令摘要 |
| `lib/desk/heartbeat.ts` | `608` | 心跳巡检（写入 activity 日志） |
| `lib/i18n.ts` | `25` | 由 A2 处理，此处仅登记 |

**统一改造模板**：

```ts
// before
const isZh = getLocale().startsWith("zh");
const text = isZh ? "中文文案" : "English text";

// after
import { normalizePromptLang, pickPromptText } from "../shared/prompt-locale.ts";
const lang = normalizePromptLang(getLocale());
const text = pickPromptText(lang, {
  zh: "中文文案",
  en: "English text",
  ja: "…", ko: "…", fr: "…", de: "…",
});
```

**验收约束**：改造后全仓 `startsWith("zh")` 计数必须只降不升，CI 需断言 ≤ 存量白名单（§8.3）。

### 5.4 D 组 — 模板与文案资源

#### D1 人格模板（新增 52 个文件）

| 目录 | ja | ko | fr | de | 单文件均 |
|---|---|---|---|---|---|
| `lib/yuan/` | 4（`jarvis` `butter` `kong` `ming`） | 4 | 4 | 4 | ~2.5 KB |
| `lib/identity-templates/` | 3 | 3 | 3 | 3 | ~100 B |
| `lib/ishiki-templates/` | 3 | 3 | 3 | 3 | ~1 KB |
| `lib/public-ishiki-templates/` | 3 | 3 | 3 | 3 | ~1.6 KB |
| **小计** | **13** | **13** | **13** | **13** | |

约定：
- 目录形如 `lib/yuan/ja/jarvis.md`，与既有 `lib/yuan/en/jarvis.md` 平级
- `kong` 在 `en/` 下本身就是空文件，各语言保持同样的空文件即可（存在性判断不受影响）
- 模板内 `{{userName}}` / `{{agentName}}` / `{{agentId}}` 占位符必须保留原样

#### D2 UI locale JSON

| 文件 | 状态 |
|---|---|
| `desktop/src/locales/ja.json` / `ko.json` | **已存在**，2994 键齐全，本次不改 |
| `desktop/src/locales/fr.json` / `de.json` | **新建**，各 2994 键，从 `en.json` 翻译 |
| `desktop/dist-renderer/locales/`、`desktop/dist-splash/locales/` | 构建产物，由 `scripts/splash-assets.mjs` 自动复制，**不手工维护** |

#### D3 prompt 文案（代码内常量）

- `core/agent-prompt-text.ts`：7 个语言 × 约 20 个段落键
- C1 / C2 批各自模块内的文案表
- 法/德文本必须经母语审校；ja/ko 可优先复用现有 UI 译者

### 5.5 E 组 — UI 与设置

| # | 文件 | 改动 |
|---|---|---|
| E1 | `desktop/src/react/onboarding/constants.ts:12-18` | `LOCALES` 增加 `{ value: 'fr', label: 'Français' }`、`{ value: 'de', label: 'Deutsch' }` |
| E2 | `lib/tools/update-settings-tool.ts:47-49` | `LOCALE_LABELS` 增加 `fr` / `de` |
| E3 | `lib/tools/update-settings-tool.ts:157` | `options` 数组增加 `"fr"`、`"de"` |
| E4 | `lib/tools/update-settings-tool.ts:142+` | 新增设置项 `agent_prompt_locale`（`type: "list"`，选项 `follow/en/zh/ja/ko/fr/de`），带 `searchTerms` |
| E5 | 设置 UI（`desktop/src/react/settings/tabs/InterfaceTab.tsx` 或新组件） | 「Agent 提示语言」下拉 + 一句说明（含"模型不支持时会自动回退英文"） |
| E6 | `desktop/src/locales/*.json`（7 份） | 新增 `settings.agentPromptLocale.*` 文案键；fr/de 直接写在新建 JSON 里 |
| E7 | 模型设置页（P3，可选） | 展示模型 `languages`，允许用户手动覆盖 |

### 5.6 F 组 — 模型能力元数据（P3）

| # | 对象 | 改动 |
|---|---|---|
| F1 | `lib/known-models.json` | 为 top 50 主流模型补 `languages`；本地小模型/单语模型显式收窄（如 `["en"]`） |
| F2 | `lib/known-models.json` 的 `_comment` | 写入 §4.3 的三态语义约定 |
| F3 | `lib/known-model-fallbacks.json` | 通用 fallback 条目**不加** `languages`（保持"未知=支持"） |
| F4 | `scripts/sync-known-models-from-pi.mjs:41-62` | `FIELD_MAP` 保持不含 `languages`，并加注释说明该字段为人工策展、禁止上游覆盖 |
| F5 | `scripts/validate-model-languages.mjs`（新增） | 校验 `languages` 取值 ∈ `PROMPT_LANGS`，CI 挂载 |

### 5.7 G 组 — 测试与脚本

| # | 文件 | 改动 |
|---|---|---|
| G1 | `tests/i18n-locale-parity.test.ts:6` | `locales` 数组加 `fr`、`de` |
| G2 | `tests/theme-registry-contract.test.ts:12` | 同上 |
| G3 | `tests/tool-label-coverage.test.ts:22` | 同上（否则 fr/de 缺 tool label 会直接红） |
| G4 | `scripts/sync-locale-parity.mjs:17` | `TARGETS` 加 `fr`、`de` |
| G5 | `tests/prompt-locale.test.ts` | **新增**，覆盖 `resolvePromptLang` / `resolveTemplatePath` / `pickPromptText` 全矩阵 |
| G6 | `tests/persona-source.test.ts` | **扩展** H1 回归用例（见 §8.1） |
| G7 | `tests/agent-locale-resolution.test.ts` | 增加 ja/ko/fr/de 探针断言 |
| G8 | `tests/agent-platform-prompt.test.ts` | 同上 |
| G9 | `tests/agent-system-prompt-section-order.test.ts` | 同上（段落顺序 + 标题语言） |
| G10 | `tests/i18n-default-load.test.ts` | 增加 fr/de 默认加载断言 |
| G11 | `scripts/check-prompt-locale-legacy.mjs`（新增） | 统计 `startsWith("zh")` 出现次数，超出白名单则失败 |

---

## 6. 分阶段实施计划

### P0 — 基础设施（阻塞项）

| 任务 | 交付物 | 工时 | 状态 |
|---|---|---|---|
| A1 `shared/prompt-locale.ts` + G5 单测 | 模块可用、矩阵覆盖 | 1.5 pd | ✅ |
| A4 `persona-source.ts` 兜底修复 + G6 回归 | H1 消除 | 0.5 pd | ✅ |
| A2 / A3 `resolveKey` 支持 fr / de | H2 消除 | 0.25 pd | ✅ |
| A8 / A9 / A10 / A11 偏好全链路 | `agent_prompt_locale` 可读写、Agent 可取 | 1 pd | ✅ |
| A5 / A6 / A7 `languages` 透传骨架 | 能力字段可读（暂无数据） | 1 pd | ✅ |
| **小计** | | **4.25 pd（记 5 pd）** |

> A1 + A4 必须先行。在它们落地前，任何新增语言目录都可能踩 H1。

### P1 — ja / ko Agent 母语化（最高 ROI）

| 任务 | 交付物 | 工时 | 状态 |
|---|---|---|---|
| B 组（`core/agent.ts` 34 处 + agent-manager + first-run） | Agent 主体多语言 | 3 pd | ✅ |
| C1 批（10 文件 17 处） | Agent 周边母语化 | 2 pd | ⬜ |
| C2 批（9 文件 16 处） | 记忆 / 日记母语化 | 2.5 pd | ⬜ |
| D1 ja / ko 模板（identity + ishiki + public-ishiki，18 文件） | 人格资产 | 1.5 pd | ✅ |
| D1 ja / ko yuan 模板（8 文件） | 能力定义 | 0.5 pd | ⬜（暂用 en 兜底） |
| ja / ko prompt 文案翻译 + 母语审校 | 翻译资产 | 2.5 pd | ✅（待母语审校） |
| G7 / G8 / G9 / G10 测试扩展 | 回归保护 | 1 pd | 🟡（G7 已完成，G8/G9/G10 待补） |
| **小计** | | **13 pd** | **已完成约 6 pd** |

### P2 — fr / de 全量母语化

| 任务 | 交付物 | 工时 |
|---|---|---|
| D2 `fr.json` / `de.json` | 2 × 2994 键 | 4 pd |
| E1 / E2 / E3 / E6 选择器与文案 | UI 就绪 | 0.5 pd |
| C1 + C2 批 fr / de 文案 | 翻译 | 4 pd |
| C3 批 fr / de（允许英文占位 + TODO） | 边缘补齐 | 0.5 pd |
| D1 fr / de 模板 26 文件 | 人格资产 | 2 pd |
| G1 ~ G4 locale 列表 + 脚本 | CI 恢复绿 | 0.5 pd |
| 端到端冒烟（4 locale × 3 场景） | 验收 | 1 pd |
| **小计** | | **12.5 pd** |

### P3 — 模型能力感知与用户覆盖

| 任务 | 交付物 | 工时 |
|---|---|---|
| F1 top 50 模型 `languages` 策展 | 数据 | 1.5 pd |
| F5 校验脚本 + CI | 防劣化 | 0.5 pd |
| E4 / E5 / E7 设置项与模型页 | 用户可控 | 2 pd |
| 能力回退集成测试（7 lang × 4 能力态） | 验收 | 1 pd |
| C3 批补全（取消 TODO 占位） | 完整性 | 0.5 pd |
| **小计** | | **5.5 pd** |

### 里程碑

| 阶段 | 累计工时 | 里程碑 |
|---|---|---|
| P0 | 5 pd | 基础设施就绪，可安全加语言 |
| P0 + P1 | **18 pd** | ✅ ja / ko Agent 母语化上线（MVP） |
| + P2 | **30.5 pd** | ✅ fr / de 全量 |
| + P3 | **36 pd** | ✅ 能力感知 + 用户覆盖，完整方案 |

> 只需 ja/ko 时 **18 人天**；四语言完整方案 **约 30-36 人天**（含翻译审校，浮动 ±20%）。

---

## 7. 工作量与成本结构

| 工作类型 | 人天 | 占比 | 说明 |
|---|---|---|---|
| 代码改造（结构重构 + 透传） | ~9 | 25% | 一次性投入，不随语言数线性增长 |
| 翻译（prompt 文案 + UI JSON） | ~15 | 42% | 随语言数线性增长 |
| 模板撰写（人格资产） | ~6 | 17% | 随语言数线性增长，ja/ko 可复用文化语境 |
| 测试与验收 | ~4 | 11% | 一次性 + 少量语言相关增量 |
| 元数据策展与工具 | ~2 | 5% | 可渐进 |
| **合计** | **~36** | 100% | |

关键杠杆：**结构改造是一次性的**。如果未来还要加第 8、第 9 种语言，边际成本只剩"翻译 + 模板 + 一条 locale 列表"，约 4-6 人天/语言。

---

## 8. 测试方案

### 8.1 单元测试矩阵

| 模块 | 用例 |
|---|---|
| `resolvePromptLang` | ① `override` 优先于一切 ② `config.locale` 优先于全局 ③ 两者都缺 → `en` ④ 已知模型不含 `ja` → 回退 `en` ⑤ 能力未知 → 保留 `ja` ⑥ `"fr-FR"` → `fr` ⑦ `"zh-Hant"` → `zh-TW` ⑧ `override="follow"` 等价于不覆盖 |
| `resolveTemplatePath` | ① `fr/x.md` 存在 → 命中 ② 缺失 → `en/x.md` ③ 再缺 → 根目录 ④ 全缺 → `null` ⑤ 空文件（0 字节）仍算存在 ⑥ `zh` 直接查根目录，不查 `zh/` |
| `pickPromptText` | ① 命中目标语言 ② 缺失 → `en` ③ `zh-TW` → `zh` → `en` |
| `normalizeModelLanguages` | ① 非数组 → `null` ② 空数组 → `null` ③ 非法值被丢弃 ④ 去重 |
| `lib/i18n.ts` `resolveKey` | `fr` / `fr-FR` → `fr`；`de` / `de-AT` → `de`；`ja-JP` → `ja`；`ko-KR` → `ko`；`xx` → `en` |

### 8.2 H1 回归用例（`tests/persona-source.test.ts` 扩展）

必须覆盖四个方向：

| 场景 | 目录状态 | 期望 |
|---|---|---|
| fr 模板存在 | `fr/jarvis.md` + 根 `jarvis.md` | 命中 `fr/jarvis.md` |
| fr 模板缺失、en 存在 | `en/jarvis.md` + 根 `jarvis.md` | **命中 `en/`，绝不能落根目录中文** |
| fr、en 都缺失 | 仅根 `jarvis.md` | 命中根目录（已知取舍，需记日志） |
| 只有 example | 仅 `identity.example.md` | 命中 example |

第二行是本方案的**核心回归断言**。

### 8.3 回归门槛

```bash
npx vitest run \
  tests/prompt-locale.test.ts \
  tests/persona-source.test.ts \
  tests/i18n-locale-parity.test.ts \
  tests/theme-registry-contract.test.ts \
  tests/tool-label-coverage.test.ts \
  tests/i18n-default-load.test.ts \
  tests/agent-locale-resolution.test.ts \
  tests/agent-platform-prompt.test.ts \
  tests/agent-system-prompt-section-order.test.ts
```

外加：

```bash
npm run typecheck
node scripts/check-prompt-locale-legacy.mjs   # startsWith("zh") 计数 ≤ 白名单
```

### 8.4 集成 / 冒烟

- `buildSystemPrompt()`：4 locale × 断言用户档案 / 环境 / 记忆三段标题语言 + 段落顺序不变
- `loadLocale("fr")` 后 `t("error.defaultChannelName")` 返回法文（非英文兜底）
- 偏好切换：`setAgentPromptLocale("en")` 后同一 agent 的 prompt 立即变英文，无需重启
- 模型能力：`languages: ["en"]` + locale `ja` → prompt 为英文，且结果 `reason === "model-unsupported"`

---

## 9. 验收标准（DoD）

1. 7 个 locale 的 `buildSystemPrompt()` 输出均含**对应语言**的用户档案 / 环境 / 记忆标题，无英文残留（C3 占位项除外）
2. `fr` / `de` 用户若未建模板目录，**绝不出现中文人格模板**（H1 回归用例绿）
3. `lib/i18n.ts` 对 `fr` / `de` 返回法 / 德文文案，不落英文兜底
4. `i18n-locale-parity` 对 fr / de 通过（2994 键全覆盖）
5. 设置项 `agent_prompt_locale` 可读写、可覆盖、支持 `follow`
6. 模型标注 `languages: ["en"]` 时，ja 用户 prompt 回退英文，且可观测到 `reason: "model-unsupported"`
7. 显式指定 `agent_prompt_locale` 时，行为完全由用户决定，不进行能力回退
8. 全仓 `startsWith("zh")` 计数 ≤ 存量白名单（只降不升）
9. `npm run typecheck` 通过

---

## 10. 风险与应对

| ID | 风险 | 等级 | 应对 |
|---|---|---|---|
| **R1** | 模板兜底掉中文（H1），fr/de 用户拿到中文人格 | 🔴 高 | P0 强制先修 A4；G6 回归用例；发布前跑 `check-prompt-locale-legacy.mjs` |
| **R2** | 翻译质量不足（尤其中 → 法 / 德的语气与敬语） | 🟠 中 | 每语言独立母语审校；ja/ko 复用现有 UI 译者；fr/de 需外部译者 |
| **R3** | prompt 变长或结构变化影响 KV cache 命中率 | 🟠 中 | 保持「静态前缀 + 动态尾部」顺序不变，只换文案不换段落结构；上线后观察命中率 |
| **R4** | 存量 ja/ko 用户行为突变（助手突然说日语） | 🟠 中 | 灰度：先以 `agent_prompt_locale = "en"` 发布，观察一版后切 `follow`；设置页给出明确说明 |
| **R5** | 小参数模型在母语 prompt 下输出劣化 | 🟠 中 | D3 能力感知 + E5 用户覆盖；文档明确「小模型建议强制 en」 |
| **R6** | ~~语音不支持 fr/de~~ **已于 v1.7 消除**：`speech-languages.ts` 扩为七语种，`resolveSpeechLanguageFromLocale` 补 fr/de 分支（未知 locale 仍回退简体中文——历史行为，未改） | ✅ 已解除 | Edge TTS 覆盖七语种；本地 TTS：fr 走 kokoro `ff_siwis`、de 无 kokoro speaker 走 Edge 兜底；本地 ASR：fr/de 走 whisper-base 按需下载 |
| **R7** | 47 处改造遗漏 | 🟠 中 | C 组清单逐项勾选；CI 计数断言；review checklist |

### 回滚策略

| 层级 | 操作 | 生效范围 |
|---|---|---|
| 单点回滚 | `preferences.agent_prompt_locale = "en"` | 全站 Agent prompt 回英文（等价改动前），**无需发版** |
| 代码回滚 | 回退版本 | 新增内容均为纯增量（新模块 / 新模板 / 新 JSON），不影响已有数据 |
| 数据兼容 | `preferences` 新增键 | 旧版本读到未知键直接忽略，无副作用 |

---

## 11. 待确认事项

| # | 问题 | 影响 |
|---|---|---|
| 1 | `agent_prompt_locale` 首发默认值是 `follow` 还是 `en`？ | 影响 R4 灰度策略与首批用户体验 |
| 2 | zh-TW 是否需要独立人格模板？ | 需要则追加 2-3 pd |
| 3 | fr / de 翻译由谁提供（外部译者 / 机翻+审校 / 社区）？ | 影响 P2 排期与质量 |
| 4 | 模型 `languages` 策展覆盖 top 50 还是长尾？ | 影响 P3 工时（1.5 ~ 5 pd） |
| 5 | C3 批是否接受长期英文占位（带 TODO 标记）？ | 影响 P2 / P3 边界 |

---

## 12. 附录

### 12.1 关键文件索引

| 用途 | 路径 |
|---|---|
| 服务端 i18n | `lib/i18n.ts` |
| 渲染端 i18n | `desktop/src/lib/i18n.js` |
| Agent locale 解析 | `core/agent.ts:279`（`resolveLocale`）、`:296`（`resolveUserName`） |
| 人格模板回落 | `core/persona-source.ts:52-75` |
| 首启模板播种 | `core/first-run.ts:208-245` |
| Agent `_cb` 注入点 | `core/agent-manager.ts:1184-1187` |
| 偏好存取 | `core/preferences-manager.ts:492`（`getLocale`）、`:513`（`setLocale`） |
| Engine 转发 | `core/engine.ts:2007-2008` |
| 配置 scope | `shared/config-schema.ts:23` |
| 模型词典 | `shared/known-models.ts`、`lib/known-models.json` |
| 模型元数据投影 | `core/model-known-enrichment.ts`、`core/model-sync.ts` |
| 设置工具注册表 | `lib/tools/update-settings-tool.ts:142+` |
| onboarding 语言项 | `desktop/src/react/onboarding/constants.ts:12` |
| 语音语言（非目标） | `core/speech/speech-languages.ts:13` |

### 12.2 47 处 `startsWith("zh")` 分组核对

| 分组 | 处数 | 说明 |
|---|---|---|
| A 组 | 2 | `lib/i18n.ts:25`、`core/persona-source.ts:60` |
| B 组 | 9 | `core/agent.ts` ×6、`core/agent-manager.ts` ×2、`core/first-run.ts` ×1 |
| C1 批 | 17 | 10 个文件 |
| C2 批 | 16 | 9 个文件 |
| C3 批 | 3 | `deepseek.ts`、`rc-summary.ts`、`heartbeat.ts` |
| **合计** | **47** | |

### 12.3 `core/agent.ts` 34 处 `isZh` 分布

```
275(注释) 299 1166 1180 1212 1221 1224 1261 1293 1300 1311 1314 1322
1338 1348 1377 1378 1385 1386 1400 1411 1428 1446 1463 1476 1486
1497 1514 1516 1551 1554  +  _formatTeamRoster 内 3 处
```

### 12.4 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-04 | v1.0 | 初稿：现状调研、H1-H3 隐患、D1-D5 决策、改动清单、分期与工作量 |
| 2026-11-04 | v1.1 | P0 实施完成：新增 `shared/prompt-locale.ts`；修复 H1 模板兜底；H2 补 fr/de 路由；新增 `agent_prompt_locale` 偏好与 `languages` 透传；新增 `tests/prompt-locale.test.ts` 与 H1 回归用例。补充 zh / zh-TW 的模板查找优先级说明 |
| 2026-11-04 | v1.2 | P1 部分完成：`core/agent.ts` 全部 `isZh` 改为 `_promptLang()` + 文案包；新增 `core/agent-prompt-text.ts`（zh/en/ja/ko）；agent-manager / first-run 模板选择统一；新增 ja/ko 人格模板 18 个；补充 ja/ko Agent 测试 |
| 2026-11-05 | v1.3 | C1 + C2 批完成：C1 批 10 文件 17 处、C2 批 9 文件 16 处全部改为 `normalizePromptLang` + `pickPromptText`（补 ja/ko 文案）；连带改造 `core/session-reminders.ts`、`core/tool-catalog.ts`（isZh 布尔参数 → lang 透传）、`lib/memory/rolling-summary-format.ts`（格式契约标题保持 `### Key Facts` / `### Timeline` 英文字面量，仅翻译说明文字）；全仓 `startsWith("zh")` 降至 5 处（1 注释 + 1 合法 zh 路由 + C3 批 3 处）；修复 12 个测试文件 llm-client mock 缺失 `DEFAULT_CALL_TEXT_TIMEOUT_MS` 的基线缺陷 |
| 2026-11-05 | v1.4 | P1 收尾：新增 `lib/yuan/{ja,ko}/{jarvis,butter,ming,kong}.md` 8 个 yuan 模板（kong 与根目录同款 2 字节空文件；`{{userName}}` 占位符与 `<mood>`/`<pulse>`/`<reflect>` 结构标签原样保留）；G8 补 ja/ko 平台名与用户档案断言、G9 补 ja/ko 段落顺序断言、G10 补 ja/ko 真实翻译与 fr/de 优雅回退断言（fr/de JSON 属 P2，断言回退 en 且不泄漏 key 字面量）。P1 仅剩母语审校 |
| 2026-11-05 | v1.5 | P2 主体完成：**D2** `desktop/src/locales/fr.json` / `de.json` 新建（以 en.json 骨架逐段翻译，2989 叶子键 0 缺失，机翻基底待母语审校）；**E1/E2/E3** onboarding `LOCALES`、`LOCALE_LABELS`、locale options 补 fr/de；**G1-G4** 四处 locale 列表加 fr/de，parity / theme / tool-label 全绿；**C1/C2** 全部小文案表（标题生成、巡检摘要、技能名翻译、agent 简介、reminder、tool-catalog、workspace 指令、vision 失败、外观标题、频道、安装审查、DeepSeek 契约、记忆标签、deep-memory、反思指令、会话摘要说话人/预算、日记小文案）补 fr/de；compile-today prompt 补 fr/de 全文；**D1** fr/de 人格模板 26 文件（yuan 8 + identity 6 + ishiki 6 + public-ishiki 6，占位符与结构标签原样保留）；**C3** deepseek / rc-summary / heartbeat 的 `startsWith("zh")` 字面量收敛到 `normalizePromptLang`（空 locale 保留历史 zh 语义，fr/de 沿用 en 占位打 TODO(P3)）。全仓 `startsWith("zh")` 降至 2 处（agent.ts 注释 + i18n.ts 合法 zh 路由）。**P2 剩余**：compile-daily / compile-longterm / compile-editable-facts / fact-extraction / rolling-summary / session-summary 滚动摘要等大型记忆 prompt 的 fr/de 初译（当前经 `pickPromptText` 优雅回退 en）；E5 设置页「Agent 提示语言」下拉（P3 项） |
| 2026-11-05 | v1.6 | P2 收尾 + P3 主体完成：**大型 prompt fr/de 全文**（compile-daily / compile-longterm / compile-editable-facts / fact-extraction / rolling-summary / session-summary 滚动摘要；含德语印刷引号修复）；**FR/DE Agent 文案包**（`core/agent-prompt-text.ts` 新增 FR/DE 两套 `AgentPromptPack` 全量字段，PACKS 映射 fr: FR / de: DE）——修掉 P2 漏项（fr/de 此前回退 EN 包导致 fr/de 用户 prompt 仍为英文）；**P3-F1** `lib/known-models.json` 231 个主流模型补 `languages`（多语 FULL7 / 中英 ZH_EN / 单语 ["en"]，本地小模型显式收窄）；**P3-F2** `_comment` 写入三态语义；**P3-F4** sync 脚本 FIELD_MAP 注释禁止加入 languages；**P3-F5** `scripts/validate-model-languages.mjs` 新增（npm run validate:languages，231 条目全合法）；**P3-E4** update-settings-tool 新增 `agent_prompt_locale` 设置项（follow/七语种 list，searchTerms 六语），7 份 locale JSON 补 `toolDef.updateSettings.agentPromptLocale*`；**P3-E5** 新增 `/api/preferences/agent-prompt-locale` GET/PUT 路由（`normalizePromptLocaleOverride` 白名单校验 + settings.write 权限门）与 InterfaceTab「Agent 提示语言」下拉（7 语 UI 键）；**能力回退测试矩阵**：agent-locale-resolution 扩展 fr/de 渲染、en-only 回退、能力未知保留、zh+en 模型下 fr 回 en 不落 zh、显式 zh 覆盖跳过能力检测；**P3-C3** deepseek roleplay marker 与 rc-summary 补 fr/de 全文（heartbeat 保持 en 占位：40 处内部 isZh 链路属后台调试文案，收益低） |
| 2026-11-05 | v1.7 | **首装语言选择链路 fr/de 核查与收尾**：onboarding 主链路确认全通（`constants.ts` LOCALES 已含 fr/de（P2-E1）、LocaleStep 遍历渲染、OnboardingApp → window.i18n.load → `_resolveKey` fr/de 路由（P0-A3）、fr/de JSON 经 vite cpSync 与 splash-assets 全量复制进 dist、saveLocale 服务端无白名单）。**补 3 处遗漏**：InterfaceTab 设置页语言下拉 5 项 → 7 项（fr/de 用户此前无法在设置页改语言）；`localeVal` 归一化补 `startsWith('fr'/'de')`（此前 fr/de 误显示选中 English）；`SettingsConfirmCard.buildLocaleLabels` 补 fr/de 标签；7 份 locale JSON 补 `settings.locale.fr/de` 自称键（en/fr/de 为自称，zh/zh-TW/ja/ko 为译名）。回归 215 用例（parity/theme/tool-label/default-load）全绿 |

### 12.5 P0 实施落地清单（v1.1）

| 文件 | 变更 |
|---|---|
| `shared/prompt-locale.ts` | **新增**：`parsePromptLang` / `normalizePromptLang` / `normalizePromptLocaleOverride` / `normalizeModelLanguages` / `modelSupportsPromptLang` / `resolveSupportedPromptLang` / `resolvePromptLang` / `promptLangDir` / `resolveTemplatePath` / `pickPromptText` |
| `core/persona-source.ts` | 改为经 `resolveTemplatePath`（`fs.existsSync` 判断），兜底顺序 `{lang}/ → en/ → 根` |
| `lib/i18n.ts`、`desktop/src/lib/i18n.js` | `resolveKey` 补 `fr` / `de` |
| `shared/known-models.ts` | 新增 `lookupModelLanguages()` |
| `core/model-known-enrichment.ts`、`core/model-sync.ts` | `languages` 透传（只补缺，不覆盖用户/运行时值） |
| `shared/config-schema.ts` | 新增 `agent_prompt_locale`（global，默认 `follow`） |
| `core/preferences-manager.ts` | 新增 `getAgentPromptLocale` / `setAgentPromptLocale` |
| `core/engine.ts` | 转发上述偏好；新增 `getModelLanguages(modelRef)` |
| `core/agent-manager.ts` | agent `_cb` 注入 `getAgentPromptLocale` / `getModelLanguages` |
| `tests/prompt-locale.test.ts` | **新增**：30 个用例覆盖解析链、模板顺序、文案回退 |
| `tests/persona-source.test.ts` | **扩展**：6 个 H1 回归用例（含"空模板仍算存在"） |

> P0 验证结果：`prompt-locale` + `persona-source` 51 测试通过；i18n / config-scope / known-models / agent-locale / first-run / settings-snapshot 77 通过；agent-manager / agents-route / update-settings 93 通过；model-sync / model-known-enrichment 103 通过；`tsc -p tsconfig.node.json` 无错误。

> 维护约定：清单中的行号以 `v1.0` 时点的 `main` 为准。若相关文件发生结构性变动，更新 §5 与 §12 的行号，不要只改代码不改文档。

### 12.6 P1 落地记录（v1.2）

**已完成**

| 文件 | 变更 |
|---|---|
| `core/agent-prompt-text.ts` | **新增**：`AgentPromptPack` 接口 + `ZH` / `EN` / `JA` / `KO` 四套文案 + `getAgentPromptPack()` |
| `core/agent.ts` | 新增 `_promptLang()`；`buildSystemPrompt` / `buildMemoryReflectionSnapshot` / `_readYuan` / `_readPublicIshiki` / `_formatTeamRoster` / `resolveUserName` 全部改走文案包与 `resolveTemplatePath`；`isZh` 引用清零 |
| `core/agent-manager.ts` | `fallbackUserNameForLocale` 走文案包；`public-ishiki.md` 播种走 `resolveTemplatePath` |
| `core/first-run.ts` | 首启 `public-ishiki.md` 播种走 `resolveTemplatePath` |
| `lib/{identity,ishiki,public-ishiki}-templates/ja/*.md` | **新增 9 个** |
| `lib/{identity,ishiki,public-ishiki}-templates/ko/*.md` | **新增 9 个** |
| `tests/agent-locale-resolution.test.ts` | 新增 6 个用例：ja/ko 渲染、zh 保持、用户覆盖、模型能力回退、能力未知 |

**验证**：`tsc -p tsconfig.node.json` 无错误；agent / persona / first-run / agent-manager / agents-route 共 **131** 个测试通过。

### 12.7 C1 + C2 批落地记录（v1.3）

**C1 批（Agent 输出与人格直接相关，10 文件 17 处）**

| 文件 | 变更 |
|---|---|
| `core/llm-utils.ts` | 7 处全部改 `normalizePromptLang` + `pickPromptText`；`localeLengthContract` 签名从 `isZh` 布尔改为 `(lang, specs)`，ja/ko 长度规格按语言给出（超长修复指令语言仍是 zh/en 二元，行为不变） |
| `core/session-coordinator.ts` | `makeBackgroundTaskPrompt` 与 reminder 链路改 `lang` 透传 |
| `core/session-reminders.ts` | **连带改造**（文档原清单外）：`collectReminderBlock` 及 4 个 format 函数的 `isZh` 参数改为 `lang: PromptLang` |
| `core/tool-catalog.ts` | **连带改造**：`formatCatalogChangeLines(diff, isZh)` → `(diff, lang)` |
| `core/workspace-instruction-files.ts` | 标题与错误文案走 `pickPromptText` |
| `core/provider-prompt-patches.ts` | DeepSeek 输出契约补 ja/ko |
| `core/vision-prepare.ts` | 视觉失败通知补 ja/ko |
| `lib/agent-appearance-summary.ts` | `isZhLocale()` → `promptLangOf()`；「你的样子」标题补 ja/ko |
| `lib/bridge/bridge-context.ts` | 平台标签 ja/ko 沿用英文（品牌名），经 `normalizePromptLang` 归一 |
| `lib/channels/channel-store.ts` | 空频道提示补 ja/ko |
| `lib/tools/install-skill.ts` | 安全审查 prompt 补 ja/ko |
| `lib/tools/web-search.ts` | 搜索区域映射经 `normalizePromptLang`（行为不变） |

**C2 批（记忆与日记，9 文件 16 处 + 连带）**

| 文件 | 变更 |
|---|---|
| `lib/memory/prompts/compile.ts` | 4 个编译 prompt（today/daily/longterm/editable-facts）补 ja/ko 全文 |
| `lib/memory/prompts/fact-extraction.ts` | 事实抽取 prompt 补 ja/ko 全文（含时间上下文规则） |
| `lib/memory/prompts/rolling-summary.ts` | 滚动摘要 prompt 补 ja/ko（基于 zh 模板结构翻译） |
| `lib/memory/rolling-summary-format.ts` | **连带改造**：格式要求/修复指令/修复输入补 ja/ko；**facts/timeline 段标题在非 zh 语言下必须保持 `### Key Facts` / `### Timeline` 英文字面量**（`compileEditableFacts` 提取契约），ja/ko 空节标记用 `- None` |
| `lib/memory/compile.ts` | 空记忆占位、delta/长期/facts 输入标签补 ja/ko；memory.md 四个标题保持 zh/en 二元（`compiled-memory-snapshot.ts` 解析契约），空栏占位符已本地化 |
| `lib/memory/deep-memory.ts` | 快照 diff 标签 + `buildTimeContextBlock` 补 ja/ko |
| `lib/memory/memory-reflection-runner.ts` | 时间线时间戳指令补 ja/ko |
| `lib/memory/session-summary.ts` | 对话文本说话人标签、`_summarizeToolCall` 全部 21 个工具标题、滚动摘要 prompt（zh 结构全文）与用户输入标签补 ja/ko |
| `lib/diary/diary-writer.ts` | 日记写作指导全文、活动记录行、压缩指令、材料错误与写作约束补 ja/ko；活动时间戳按 locale 取 ja-JP / ko-KR |

**测试修复**

- `tests/session-reminders.test.ts` / `tests/session-reference-block.test.ts` / `tests/agent-roster-active-provider.test.ts`：`isZh` 布尔入参改为 `lang`（"zh" / "en"）
- 12 个测试文件的 `vi.mock("../core/llm-client.js")` 补上 `DEFAULT_CALL_TEXT_TIMEOUT_MS` 导出（基线缺陷，此前 30+ 个用例因此误报失败）

**验证**：`npm run typecheck` 仅剩 4 个与 i18n 无关的基线错误（auto-updater / browser-manager-external / gateway-client / launch-integrity，改造前已存在）；i18n/session/memory/diary/tool-catalog/provider/vision 相关 **18 个套件 448 用例**通过；2 个失败为基线问题（better-sqlite3 NODE_MODULE_VERSION 不匹配、model-sync-routes 基线断言），与本次改动无关（已用 stash 对照验证）。

**未完成（P1 余项）**

| 项 | 说明 |
|---|---|
| ja / ko prompt 文案母语审校 | C1/C2/滚动摘要/日记/yuan 模板的 ja/ko 翻译为初译，需母语审校后即可关闭 P1 |

### 12.8 P2 落地记录（v1.5）

| 组 | 变更 |
|---|---|
| D2 | `desktop/src/locales/fr.json` / `de.json` **新建**：以 en.json 为骨架逐段机翻（merge 脚本按 en 键序重建嵌套，含数组与扁平点号键），parity 0 缺失；质量定位为机翻基底，待母语审校 |
| E | `desktop/src/react/onboarding/constants.ts` LOCALES 加 `fr`/`de`；`lib/tools/update-settings-tool.ts` LOCALE_LABELS、locale options、searchTerms 补 fr/de |
| G | `tests/i18n-locale-parity.test.ts` / `tests/tool-label-coverage.test.ts` / `tests/theme-registry-contract.test.ts` / `scripts/sync-locale-parity.mjs` 四处 locale 列表加 fr/de；G10 断言更新为 fr/de 真实语言包（"Équipe"/"Crew"） |
| C1/C2 | 全部 `pickPromptText` 小文案表补 fr/de（清单见 v1.5 变更记录）；`core/llm-utils.ts` 的 `localeLengthContract` 扩展接受 fr/de 规格 |
| C3 | `deepseek.ts` / `rc-summary.ts` / `heartbeat.ts` 去除 `startsWith("zh")` 字面量，改经 `normalizePromptLang` 派生（空 locale 保留 zh 历史语义），fr/de 文案留 TODO(P3) 占位 en |
| D1 | fr/de 人格模板 26 文件：`lib/yuan/{fr,de}/`（jarvis/butter/ming/kong）、`lib/{identity,ishiki,public-ishiki}-templates/{fr,de}/`（各 3）；占位符与 `<mood>`/`<pulse>`/`<reflect>` 结构标签原样保留 |

**P2 验证**：typecheck 仅剩 4 个与 i18n 无关的基线错误；i18n/agent/memory/diary/tool 相关 **23 套件 532 用例**通过；`startsWith("zh")` 全仓 2 处（均为合法残留）。

### 12.9 P3 落地记录（v1.6）

| 项 | 变更 |
|---|---|
| F1 | `lib/known-models.json`：231 个模型新增 `languages`（openai/anthropic/gemini/deepseek/dashscope/moonshot/zhipu/minimax/volcengine/xai/mistral/perplexity/groq/ollama/hunyuan/baichuan/baidu-cloud/siliconflow/modelscope/openrouter/jarvis-gateway）；多语旗舰 FULL7，中英模型 ZH_EN，单语/本地小模型显式 `["en"]` 收窄 |
| F2 | `_comment` 写入三态语义（缺失=未知=乐观支持；["en"]=单语回退；含目标语言=支持；zh-TW 复用 zh；fallback 条目不写） |
| F3 | 通用 fallback 条目（`lib/known-model-fallbacks.json`）未加 languages，保持"未知=支持" ✓ |
| F4 | `scripts/sync-known-models-from-pi.mjs` FIELD_MAP 保持不含 languages，注释写明禁止加入及原因 |
| F5 | `scripts/validate-model-languages.mjs` **新增**（languages ∈ PROMPT_LANGS 白名单、拒绝空数组与重复项）；挂载为 `npm run validate:languages` |
| E4 | `lib/tools/update-settings-tool.ts` 新增 `agent_prompt_locale` list 设置项（follow/en/zh/ja/ko/fr/de + searchTerms）；7 份 locale JSON 补 toolDef 键 |
| E5 | `server/routes/preferences.ts` 新增 GET/PUT `/api/preferences/agent-prompt-locale`（normalizePromptLocaleOverride 白名单 + denyWithoutScope("settings.write")）；`InterfaceTab.tsx` locale 区新增「Agent 提示语言」下拉；7 份 locale JSON 补 settings.agentPromptLocale.* UI 键 |
| 测试 | `tests/agent-locale-resolution.test.ts` 扩展：fr/de 母语渲染、en-only 回退、能力未知保留、zh+en 模型下 fr 回 en（绝不落 zh）、显式 zh 覆盖跳过能力检测 |
| C3 补全 | `deepseek.ts` roleplay 沉思指令、`rc-summary.ts` 摘要 prompt/标签/长度契约补 fr/de 全文；heartbeat 保留 en 占位（40 处内部 isZh 调试链路，TODO 注释已留） |

**P3 验证**：`npm run validate:languages` 231 条目全合法；最终回归 **32 套件 708/709 用例通过**（唯一失败为 v1.3 已记录的 better-sqlite3 基线环境问题）；typecheck 除 4 个基线错误外干净。

### 12.10 语音 fr/de 补齐记录（v1.7 补记）

原非目标（§1.3/R6）按用户要求转正。语音语言的单一数据源是 `core/speech/speech-languages.ts`，设置页语言下拉（provider 声明下发）、音色过滤、就绪清单（`/api/sherpa/status` 的 languages）、EDGE-TTS 音色目录全部由它派生，改数据源即全局生效。

| 层 | 变更 |
|---|---|
| `core/speech/speech-languages.ts` | `SpeechLanguageId` 加 `fr`/`de`；新增两条目——fr：Edge 音色 Denise/Henri/VivienneMultilingual（默认 Denise），本地 TTS 走 `kokoro-multi` + speaker `ff_siwis`（kokoro v1.0 起内置的法语 speaker），本地 ASR 走 `whisper-base`；de：Edge 音色 Katja/Conrad/Amala（默认 Katja），本地 TTS 缺位（kokoro v1.1 无德语 speaker，`sherpaTtsModelDir: null`，Edge 在线兜底），本地 ASR 同走 `whisper-base`；`resolveSpeechLanguageFromLocale` 补 `startsWith("fr"/"de")` 分支（未知 locale 回退简中的历史行为未改） |
| `shared/sherpa-models.json` | 新增 `asr-whisper-base` 下载条目（pinned：sherpa-onnx 官方 asr-models release 的 `sherpa-onnx-whisper-base.tar.bz2`，langs ["fr","de"]，verify 为存在性校验、sha256 待首次拉取后固化）；`tts-kokoro-multi` 的 langs 加 `"fr"` |
| `core/speech-recognition/adapters.ts` | `runSherpaOfflineAsr` 加 whisper 分支（`*-encoder*.onnx` 特征探测，优先 int8）：`--whisper-encoder/--whisper-decoder/--whisper-tokens` 三参走 `sherpa-onnx-offline` CLI；sense-voice 与流式 zipformer 路径不受影响 |
| 7 份 locale JSON | `settings.voice.languages.fr/de` 下拉自称/译名键 |

**生效路径**：设置-语音-语言下拉与音色列表（provider 从 `SPEECH_LANGUAGES` 静态声明）→ 自动出现 Français/Deutsch；语音模型下载面板 → 自动出现 asr-whisper-base 条目（langs 标注 fr / de）；TTS 服务按 UI locale 自动选语音语言（`resolveSpeechLanguageFromLocale`）→ fr/de 界面用户开箱即得 Edge 音色。

**验证**：`tests/speech-languages.test.ts` 扩为七语种断言（含 fr/de 的 SSML 推导、locale 映射、默认音色、本地模型指向）；speech 全家 + locale parity 共 **227 用例通过**。`tests/provider-media-capabilities.test.ts` 的 2 个失败（minimax ratio / Agnes baseUrl）为基线问题，与语音无关（stash 对照确认）。

**注意事项**：whisper-base 的 sha256 尚未固化（存在性校验）；模型 URL 未在沙箱环境实测可达（内网无外网），首次发布前建议人工点一次下载或跑一遍安装任务确认。kokoro `ff_siwis` speaker id 基于 kokoro v1.0/v1.1 官方 speaker 表。

**整体剩余（非代码项）**

| 项 | 说明 |
|---|---|
| ja / ko / fr / de 母语审校 | 全部机器初译（D2 JSON、C1/C2 文案、大型 prompt、yuan/人格模板、Agent 文案包）需母语审校 |
| heartbeat fr/de 文案 | 后台巡检调试链路（40 处内部 isZh），占位 en，待后续按需补全 |
| E7 模型设置页 languages 展示 | 可选项（doc §5.7），用户可在 provider 页看模型 languages 的 UI 呈现，未实现 |