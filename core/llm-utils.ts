/**
 * LLM Utilities — 轻量 LLM 调用（标题摘要、翻译、ID 生成等）
 *
 * 纯函数模块，不持有状态。调用方传入 utilConfig（model/api_key/base_url）。
 * 从 Engine 提取，消除 5 处重复的 fetch 模式。
 */
import fs from "fs";
import path from "path";
import { callText } from "./llm-client.ts";
import { callTextConfigFromUtilityConfig } from "./model-execution-config.ts";
import { callTextWithLengthContract, type OutputLengthContract } from "./output-length-contract.ts";
import { normalizePromptLang, pickPromptText, type PromptLang } from "../shared/prompt-locale.ts";
import { getLocale } from "../lib/i18n.ts";
import { normalizePlainDescription } from "../lib/text/internal-narration.ts";
import { createModuleLogger } from "../lib/debug-log.ts";

const log = createModuleLogger("llm-utils");

/**
 * 格式化错误消息，透传 err.cause 的根因信息。
 * 当 fetch 失败时（如代理 ECONNREFUSED），顶层 message 是 "fetch failed"，
 * 真正的根因在 err.cause 里；不展开 cause 会让诊断日志没有任何价值。
 */
function formatError(err) {
  const top = err?.message || String(err);
  if (!err?.cause) return top;
  const cause = err.cause;
  const causeMsg = cause?.message || String(cause);
  const causeCode = cause?.code ? ` [${cause.code}]` : "";
  return `${top} — caused by: ${causeMsg}${causeCode}`;
}

/** Pi SDK content block 是否为工具调用（兼容 tool_use / toolCall 两种格式） */
export const isToolCallBlock = (b) => (b.type === "tool_use" || b.type === "toolCall") && !!b.name;

/** 取工具调用参数（兼容 input / arguments） */
export const getToolArgs = (b) => b.input || b.arguments;

/**
 * 统一的 utility LLM 调用
 * @param {object} opts
 * @param {string} opts.model
 * @param {string} opts.apiKey
 * @param {string} opts.baseUrl
 * @param {Array} opts.messages
 * @param {number} [opts.temperature=0.3]
 * @param {number} [opts.max_tokens] 任务级输出预算；未传时不写 output cap
 * @param {"user"|"system"|"sdk-default"} [opts.outputBudgetSource=system]
 * @returns {Promise<string|null>} 回复文本
 */
async function callLlm({
  model,
  api,
  apiKey,
  baseUrl,
  headers,
  messages,
  temperature = 0.3,
  max_tokens,
  outputBudgetSource = "system",
  timeoutMs,
  signal,
  quirks,
  usageLedger,
  usageContext,
  lengthContract,
}: {
  model: any;
  api: any;
  apiKey: any;
  baseUrl: any;
  headers?: any;
  messages: any;
  temperature?: number;
  max_tokens?: any;
  outputBudgetSource?: string;
  timeoutMs?: any;
  signal?: any;
  quirks?: any;
  usageLedger?: any;
  usageContext?: any;
  lengthContract?: OutputLengthContract;
}): Promise<string> {
  const request = {
    api, model,
    apiKey,
    baseUrl,
    headers,
    messages, temperature,
    ...(max_tokens != null && { maxTokens: max_tokens, outputBudgetSource }),
    ...(timeoutMs != null && { timeoutMs }),
    ...(signal != null && { signal }),
    ...(quirks != null && { quirks }),
    ...(usageLedger != null && { usageLedger }),
    ...(usageContext != null && { usageContext }),
  };
  if (lengthContract) {
    const result = await callTextWithLengthContract({
      callText,
      request,
      contract: lengthContract,
    });
    return result.text;
  }
  return callText({
    ...request,
    ...(max_tokens != null && { maxTokens: max_tokens, outputBudgetSource }),
  }) as Promise<string>;
}

function utilityUsageContext(utilConfig, operation, trigger = "tool") {
  const agentId = utilConfig?.usageAgentId || null;
  const sessionId = utilConfig?.usageSessionId || null;
  const sessionPath = utilConfig?.usageSessionPath || null;
  return {
    source: {
      subsystem: "utility",
      operation,
      surface: "system",
      trigger,
    },
    attribution: sessionId || sessionPath
      ? {
          kind: "session",
          agentId,
          ...(sessionId ? { sessionId } : {}),
          ...(sessionPath ? { sessionPath } : {}),
        }
      : { kind: "utility", agentId },
  };
}

type LengthContractSpec = {
  label: string;
  target: number;
  unit?: "chars" | "words";
  min?: number;
  max?: number;
};

/**
 * 按语言生成长度契约。zh-TW 复用 zh；ja / ko 未提供时回退 en 的规格。
 * locale 字段只影响超长修复指令的语言（core/output-length-contract.ts 仍是
 * zh/en 二元），因此 ja / ko 统一映射为 "en"，保持修复行为与改造前一致。
 */
function localeLengthContract(
  lang: PromptLang,
  specs: { zh: LengthContractSpec; en: LengthContractSpec; ja?: LengthContractSpec; ko?: LengthContractSpec; fr?: LengthContractSpec; de?: LengthContractSpec },
): OutputLengthContract {
  const key = lang === "zh-TW" ? "zh" : lang;
  const spec = (key === "zh" ? specs.zh : key === "en" ? specs.en : specs[key as "ja" | "ko" | "fr" | "de"]) ?? specs.en;
  return { ...spec, locale: lang === "zh" || lang === "zh-TW" ? "zh" : "en" };
}

/**
 * 从 .jsonl session 文件提取 user/assistant 文本和工具调用
 */
function parseSessionContent(sessionPath, { userLimit = 1000, assistantLimit = 1000 } = {}) {
  const raw = fs.readFileSync(sessionPath, "utf-8");
  const lines = raw.trim().split("\n").map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  let userText = "";
  let assistantText = "";
  const toolCalls = [];
  for (const line of lines) {
    if (line.type !== "message" || !line.message) continue;
    const msg = line.message;
    if (msg.role === "user" && !userText) {
      const textParts = (msg.content || []).filter(c => c.type === "text");
      userText = textParts.map(c => c.text).join("\n").slice(0, userLimit);
    }
    if (msg.role === "assistant") {
      const textParts = (msg.content || []).filter(c => c.type === "text");
      assistantText = textParts.map(c => c.text).join("\n").slice(0, assistantLimit);
      const toolParts = (msg.content || []).filter(isToolCallBlock);
      for (const t of toolParts) toolCalls.push(t.name || "unknown_tool");
    }
  }
  return { userText, assistantText, toolCalls };
}

/**
 * 从 session 内容生成本地兜底摘要（不依赖外部 API）
 */
export function buildLocalSummary(assistantText, toolCalls) {
  const lang = normalizePromptLang(getLocale());
  const uniqueTools = [...new Set(toolCalls)];
  if (uniqueTools.length > 0) {
    const names = uniqueTools.slice(0, 3);
    const more = uniqueTools.length > 3;
    return pickPromptText(lang, {
      zh: `执行了 ${names.join("、")}${more ? " 等" : ""}`,
      ja: `${names.join("、")}${more ? " など" : ""}を実行しました`,
      ko: `${names.join(", ")}${more ? " 등" : ""} 실행`,
      fr: `A exécuté ${names.join(", ")}${more ? ", etc." : ""}`,
      de: `Ausgeführt: ${names.join(", ")}${more ? " usw." : ""}`,
      en: `Ran ${names.join(", ")}${more ? ", etc." : ""}`,
    });
  }
  if (assistantText) {
    const clean = assistantText.replace(/[#*_`>\-[\]()]/g, "").trim();
    if (clean.length <= 50) return clean;
    return clean.slice(0, 47) + "...";
  }
  return null;
}

/**
 * 生成对话标题
 * @param {object} utilConfig - resolveUtilityConfig() 结果
 * @param {string} userText
 * @param {string} assistantText
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function summarizeTitle(utilConfig, userText, assistantText, opts: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  try {
    const lang = normalizePromptLang(getLocale());
    const execution = callTextConfigFromUtilityConfig(utilConfig);
    if (!execution.model || !execution.baseUrl || !execution.api) return null;

    const systemContent = pickPromptText(lang, {
      zh: `你是一个对话标题生成器。根据用户和助手的第一轮对话，用一句极短的话概括对话主题。

规则：
1. 标题目标约 10 个字（中文）或 5 个单词（英文），保持极短
2. 语言必须和用户说的第一句话一致：用户说中文就用中文，用户说英文就用英文
3. 不要加引号、句号或其他标点
4. 直接输出标题，不要解释`,
      ja: `あなたは会話タイトル生成器です。ユーザーとアシスタントの最初のやり取りをもとに、会話の主題をごく短い一言で要約してください。

ルール:
1. タイトルの目標は約 10 文字（日本語）または 5 語（英語）。ごく短く保つこと
2. 言語はユーザーの最初の発言に合わせること：日本語なら日本語、英語なら英語
3. 引用符や句読点などを付けないこと
4. 説明なしでタイトルのみを出力すること`,
      ko: `당신은 대화 제목 생성기입니다. 사용자와 어시스턴트의 첫 대화를 바탕으로 대화 주제를 아주 짧은 한 문구로 요약하세요.

규칙:
1. 제목은 약 10자(한국어) 또는 5단어(영어) 수준으로 아주 짧게 유지할 것
2. 언어는 사용자의 첫 발화와 일치시킬 것: 한국어면 한국어, 영어면 영어
3. 따옴표, 마침표 등 다른 문장 부호를 붙이지 말 것
4. 설명 없이 제목만 출력할 것`,
      fr: `Tu es un générateur de titres de conversation. À partir du premier échange entre l'utilisateur et l'assistant, résume le sujet en une formule très courte.

Règles :
1. Vise environ 5 mots en français ou 10 caractères en chinois/japonais, et reste très court
2. La langue du titre doit correspondre à celle du premier message de l'utilisateur
3. Pas de guillemets, de points ni d'autre ponctuation
4. Sors uniquement le titre, sans explication`,
      de: `Du bist ein Konversationstitel-Generator. Fasse das Thema des ersten Austauschs zwischen Benutzer und Assistent in einer sehr kurzen Formel zusammen.

Regeln:
1. Ziel sind etwa 5 Wörter auf Deutsch oder 10 Zeichen auf Chinesisch/Japanisch, und halte es sehr kurz
2. Die Titelsprache muss der ersten Nachricht des Benutzers entsprechen
3. Keine Anführungszeichen, Punkte oder sonstige Satzzeichen
4. Gib nur den Titel aus, ohne Erklärung`,
      en: `You are a conversation title generator. Based on the first exchange between user and assistant, summarize the topic in a very short phrase.

Rules:
1. Aim for about 5 words in English or 10 characters in Chinese, and keep it very short
2. The title language must match the user's first message
3. No quotes, periods, or other punctuation
4. Output the title directly, no explanation`,
    });

    const userLabel = pickPromptText(lang, { zh: "用户", ja: "ユーザー", ko: "사용자", fr: "Utilisateur", de: "Benutzer", en: "User" });
    const assistantLabel = pickPromptText(lang, { zh: "助手", ja: "アシスタント", ko: "어시스턴트", fr: "Assistant", de: "Assistent", en: "Assistant" });

    return await callLlm({
      ...execution,
      messages: [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: `${userLabel}：${(userText || "").slice(0, 500)}\n${assistantLabel}：${(assistantText || "").slice(0, 500)}`,
        },
      ],
      lengthContract: localeLengthContract(lang, {
        zh: { label: "标题", target: 10, unit: "chars", min: 1 },
        en: { label: "title", target: 5, unit: "words", min: 1 },
        ja: { label: "タイトル", target: 10, unit: "chars", min: 1 },
        ko: { label: "제목", target: 10, unit: "chars", min: 1 },
        fr: { label: "titre", target: 5, unit: "words", min: 1 },
        de: { label: "Titel", target: 5, unit: "words", min: 1 },
      }),
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "title", "user"),
    });
  } catch (err) {
    // AbortError（超时）不算失败，静默返回 null 让调用方走 fallback
    if (err.name === "AbortError" || err.name === "TimeoutError" || err.code === "LLM_TIMEOUT") return null;
    log.error(`summarizeTitle failed: ${formatError(err)}`);
    return null;
  }
}

/**
 * 批量翻译技能名称
 */
export async function translateSkillNames(utilConfig, names, lang) {
  if (!names.length) return {};
  const LANG_LABEL = { zh: "中文", ja: "日本語", ko: "한국어" };
  const label = LANG_LABEL[lang] || lang;
  try {
    const execution = callTextConfigFromUtilityConfig(utilConfig);
    if (!execution.model || !execution.baseUrl || !execution.api) return {};
    const lang = normalizePromptLang(getLocale());
    const text = await callLlm({
      ...execution,
      messages: [
        {
          role: "system",
          content: pickPromptText(lang, {
            zh: `将下列 kebab-case 英文技能名翻译成简短的${label}名称（2-4 个字）。直接输出 JSON 对象，key 为原名，value 为翻译。不解释。`,
            ja: `以下の kebab-case 英語のスキル名を、短い${label}名（2〜4 文字程度）に翻訳してください。key が元の名前、value が翻訳である JSON オブジェクトのみを出力し、説明は書かないこと。`,
            ko: `다음 kebab-case 영어 스킬 이름을 짧은 ${label} 이름(2-4자)으로 번역하세요. 원래 이름을 key, 번역을 value로 하는 JSON 객체만 출력하고 설명은 하지 말 것.`,
            fr: `Traduis les noms de skills anglais en kebab-case suivants en noms courts en ${label} (2 à 4 caractères). Sors directement un objet JSON, key = nom d'origine, value = traduction. Pas d'explication.`,
            de: `Übersetze die folgenden kebab-case englischen Skillnamen in kurze ${label}-Namen (2-4 Zeichen). Gib direkt ein JSON-Objekt aus, key = Originalname, value = Übersetzung. Keine Erklärung.`,
            en: `Translate the following kebab-case English skill names into short ${label} names (2-4 characters). Output a JSON object directly, key = original name, value = translation. No explanation.`,
          }),
        },
        { role: "user", content: JSON.stringify(names) },
      ],
      temperature: 0,
      max_tokens: 200,
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "translate_skill_names", "startup"),
    });
    if (!text) return {};
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch (err) {
    log.error(`translateSkillNames 失败: ${formatError(err)}`);
    return {};
  }
}

/**
 * 为活动 session 生成摘要（用 utility_large 模型）
 * @param {object} utilConfig - resolveUtilityConfig() 结果
 * @param {string} sessionPath
 * @param {(text: string, level?: string) => void} [emitDevLog]
 */
export async function summarizeActivity(utilConfig, sessionPath, emitDevLog, preloaded) {
  const log = emitDevLog || (() => {});
  const lang = normalizePromptLang(getLocale());
  try {
    let userText, assistantText, toolCalls;
    if (preloaded) {
      userText = preloaded.userText || "";
      assistantText = preloaded.assistantText || "";
      toolCalls = preloaded.toolCalls || [];
    } else {
      ({ userText, assistantText, toolCalls } = parseSessionContent(sessionPath));
    }
    if (!userText && !assistantText) {
      log("[summarize] session empty, skipping");
      return null;
    }

    const toolNames = [...new Set(toolCalls)];
    const toolInfo = toolCalls.length > 0
      ? pickPromptText(lang, {
          zh: `\n\n调用的工具：${toolNames.join("、")}`,
          ja: `\n\n使用したツール：${toolNames.join("、")}`,
          ko: `\n\n사용한 도구: ${toolNames.join(", ")}`,
          fr: `\n\nOutils utilisés : ${toolNames.join(", ")}`,
          de: `\n\nVerwendete Werkzeuge: ${toolNames.join(", ")}`,
          en: `\n\nTools used: ${toolNames.join(", ")}`,
        })
      : "";
    const execution = callTextConfigFromUtilityConfig(utilConfig, "utility_large");
    if (!execution.model || !execution.baseUrl || !execution.api) {
      log("[summarize] utility_large config incomplete, skipping");
      return null;
    }

    const systemContent = pickPromptText(lang, {
      zh: `你是一个执行摘要生成器。根据 Agent 的巡检上下文、执行结果和使用的工具，概括它做了什么。

规则：
1. 用中文，目标约 50 字，可在 30-100 字之间自然浮动
2. 直接输出摘要，不要前缀、不要解释
3. 说清楚做了什么具体动作（拆解待办、搜索信息、标记完成、读取文件等）
4. 如果调用了工具，提一下工具名称和做了什么
5. 如果 Agent 回复了「一切正常」或没有执行动作，就说「巡检完毕，一切正常」`,
      ja: `あなたは実行サマリー生成器です。Agent のパトロールコンテキスト・実行結果・使用したツールをもとに、何をしたかを要約してください。

ルール:
1. 日本語で、目標は約 50 字。30〜100 字の範囲で自然に調整すること
2. サマリーのみを出力し、接頭辞や説明を付けないこと
3. 具体的なアクションを明示すること（タスク分解、情報検索、完了マーク、ファイル読み取りなど）
4. ツールを使用した場合は、ツール名と何をしたかに触れること
5. Agent が「一切正常（問題なし）」と返信した、または実行アクションがない場合は「パトロール完了、問題なし」と出力すること`,
      ko: `당신은 실행 요약 생성기입니다. Agent의 순찰 컨텍스트, 실행 결과, 사용한 도구를 바탕으로 무엇을 했는지 요약하세요.

규칙:
1. 한국어로 작성하며, 목표는 약 50자, 30-100자 범위에서 자연스럽게 조정할 것
2. 요약만 출력하고 접두어나 설명을 붙이지 말 것
3. 구체적으로 어떤 작업을 했는지 명시할 것(할 일 분해, 정보 검색, 완료 표시, 파일 읽기 등)
4. 도구를 사용했다면 도구 이름과 한 일을 언급할 것
5. Agent가 "이상 없음"이라고 답했거나 실행한 작업이 없다면 "순찰 완료, 이상 없음"이라고 출력할 것`,
      fr: `Tu es un générateur de résumé d'exécution. À partir du contexte de patrouille de l'Agent, des résultats d'exécution et des outils utilisés, résume ce qu'il a fait.

Règles :
1. En français, vise environ 30 mots ; 18 à 60 mots sont acceptables
2. Sors le résumé directement, sans préfixe ni explication
3. Sois précis sur les actions entreprises (décomposition de tâches, recherche d'informations, marquage terminé, lecture de fichiers, etc.)
4. Si des outils ont été appelés, mentionne leur nom et ce qu'ils ont fait
5. Si l'Agent a répondu « tout est en ordre » ou n'a rien fait, dis « Patrouille terminée, tout est en ordre »`,
      de: `Du bist ein Ausführungszusammenfassungs-Generator. Fasse anhand des Patrouillenkontexts des Agenten, der Ausführungsergebnisse und der verwendeten Werkzeuge zusammen, was er getan hat.

Regeln:
1. Auf Deutsch, etwa 30 Wörter; 18-60 Wörter sind akzeptabel
2. Gib die Zusammenfassung direkt aus, kein Präfix, keine Erklärung
3. Sei konkret bei den unternommenen Aktionen (Aufgaben zerlegt, Infos gesucht, als erledigt markiert, Dateien gelesen usw.)
4. Wenn Werkzeuge aufgerufen wurden, erwähne deren Namen und was sie taten
5. Hat der Agent „alles in Ordnung" gemeldet oder nichts unternommen, sage „Patrouille abgeschlossen, alles in Ordnung"`,
      en: `You are an execution summary generator. Based on the Agent's patrol context, execution results, and tools used, summarize what it did.

Rules:
1. In English, aim for about 30 words; 18-60 words is acceptable
2. Output the summary directly, no prefix or explanation
3. Be specific about what actions were taken (broke down tasks, searched info, marked complete, read files, etc.)
4. If tools were called, mention the tool names and what they did
5. If the Agent reported "all clear" or took no action, say "Patrol complete, all clear"`,
    });

    const contextLabel = pickPromptText(lang, {
      zh: "巡检上下文",
      ja: "パトロールコンテキスト",
      ko: "순찰 컨텍스트",
      fr: "Contexte de patrouille",
      de: "Patrouillenkontext",
      en: "Patrol context",
    });
    const replyLabel = pickPromptText(lang, {
      zh: "Agent 回复",
      ja: "Agent の返信",
      ko: "Agent 응답",
      fr: "Réponse de l'Agent",
      de: "Antwort des Agenten",
      en: "Agent reply",
    });

    const { text } = await callTextWithLengthContract({
      callText,
      request: {
        ...execution,
        signal: undefined,
        messages: [
          { role: "system", content: systemContent },
          {
            role: "user",
            content: `${contextLabel}：\n${userText.slice(0, 600)}\n\n${replyLabel}：\n${assistantText.slice(0, 600)}${toolInfo}`,
          },
        ],
        temperature: 0.3,
        usageLedger: utilConfig.usageLedger,
        usageContext: utilityUsageContext(utilConfig, "activity_summary", "scheduled"),
      },
      contract: localeLengthContract(lang, {
        zh: { label: "执行摘要", target: 50, unit: "chars", min: 1 },
        en: { label: "execution summary", target: 30, unit: "words", min: 1 },
        ja: { label: "実行サマリー", target: 50, unit: "chars", min: 1 },
        ko: { label: "실행 요약", target: 50, unit: "chars", min: 1 },
        fr: { label: "résumé d'exécution", target: 30, unit: "words", min: 1 },
        de: { label: "Ausführungszusammenfassung", target: 30, unit: "words", min: 1 },
      }),
    });

    return text;
  } catch (err) {
    log(`[summarize] error: ${formatError(err)}`);
    log.error(`summarizeActivity failed: ${formatError(err)}`);
    return null;
  }
}

/**
 * 快速摘要（用 utility 小模型）
 * @param {object} utilConfig
 * @param {string} sessionPath - activity session 文件绝对路径
 */
export async function summarizeActivityQuick(utilConfig, sessionPath) {
  if (!fs.existsSync(sessionPath)) return null;
  const lang = normalizePromptLang(getLocale());
  try {
    const { userText, assistantText } = parseSessionContent(sessionPath, {
      userLimit: 800, assistantLimit: 800,
    });
    if (!userText && !assistantText) return null;

    const execution = callTextConfigFromUtilityConfig(utilConfig);
    if (!execution.model || !execution.baseUrl || !execution.api) return null;

    const systemContent = pickPromptText(lang, {
      zh: `根据 Agent 的巡检上下文和执行结果，用一两句话概括它做了什么。目标约 30 字，可在 18-60 字之间自然浮动。中文，直接输出。`,
      ja: `Agent のパトロールコンテキストと実行結果をもとに、何をしたかを一〜二文で要約してください。目標は約 30 字、18〜60 字の範囲で自然に調整すること。日本語で、直接出力すること。`,
      ko: `Agent의 순찰 컨텍스트와 실행 결과를 바탕으로 무엇을 했는지 한두 문장으로 요약하세요. 목표는 약 30자, 18-60자 범위에서 자연스럽게 조정할 것. 한국어로, 바로 출력할 것.`,
      fr: `À partir du contexte de patrouille et des résultats d'exécution de l'Agent, résume ce qu'il a fait en une ou deux phrases. Vise environ 15 mots ; 9 à 30 mots sont acceptables. En français, sortie directe.`,
      de: `Fasse anhand des Patrouillenkontexts und der Ausführungsergebnisse des Agenten zusammen, was er getan hat, in ein bis zwei Sätzen. Ziel etwa 15 Wörter; 9-30 Wörter sind akzeptabel. Auf Deutsch, direkt ausgeben.`,
      en: `Based on the Agent's patrol context and execution results, summarize what it did in one or two sentences. Aim for about 15 words; 9-30 words is acceptable. English, output directly.`,
    });

    const contextLabel = pickPromptText(lang, {
      zh: "巡检上下文",
      ja: "パトロールコンテキスト",
      ko: "순찰 컨텍스트",
      fr: "Contexte de patrouille",
      de: "Patrouillenkontext",
      en: "Patrol context",
    });
    const replyLabel = pickPromptText(lang, {
      zh: "Agent 回复",
      ja: "Agent の返信",
      ko: "Agent 응답",
      fr: "Réponse de l'Agent",
      de: "Antwort des Agenten",
      en: "Agent reply",
    });

    const { text } = await callTextWithLengthContract({
      callText,
      request: {
        ...execution,
        signal: undefined,
        messages: [
          { role: "system", content: systemContent },
          {
            role: "user",
            content: `${contextLabel}：\n${userText.slice(0, 400)}\n\n${replyLabel}：\n${assistantText.slice(0, 400)}`,
          },
        ],
        temperature: 0.3,
        usageLedger: utilConfig.usageLedger,
        usageContext: utilityUsageContext(utilConfig, "activity_summary_quick", "scheduled"),
      },
      contract: localeLengthContract(lang, {
        zh: { label: "快速摘要", target: 30, unit: "chars", min: 1 },
        en: { label: "quick summary", target: 15, unit: "words", min: 1 },
        ja: { label: "クイックサマリー", target: 30, unit: "chars", min: 1 },
        ko: { label: "빠른 요약", target: 30, unit: "chars", min: 1 },
        fr: { label: "résumé rapide", target: 15, unit: "words", min: 1 },
        de: { label: "Kurzzusammenfassung", target: 15, unit: "words", min: 1 },
      }),
    });
    return text;
  } catch (err) {
    log.error(`summarizeActivityQuick failed: ${formatError(err)}`);
    return null;
  }
}

/**
 * 规整为合法 agent id 的 slug：小写字母/数字/连字符，首尾去横线、合并连续横线、截断 12 字符。
 * 返回空字符串表示洗完啥也不剩（如纯 emoji 输入）。
 */
function sanitizeAgentId(raw) {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 12)
    .replace(/-+$/g, ""); // 截断后可能留下尾部横线
}

/**
 * 在 agentsDir 下为 base 找一个不冲突的 id：base → base-2 → base-3 → ...
 * 超上限返回 null，交给调用方走时间戳兜底。
 */
function findAvailableAgentId(base, agentsDir, max = 99) {
  if (!base) return null;
  if (!fs.existsSync(path.join(agentsDir, base))) return base;
  for (let i = 2; i <= max; i++) {
    // 候选可能超 12 字符（如 "jarvisjarvis-12"），做截断后再试
    const suffix = `-${i}`;
    const trimmedBase = base.slice(0, Math.max(2, 12 - suffix.length));
    const candidate = `${trimmedBase}${suffix}`;
    if (!fs.existsSync(path.join(agentsDir, candidate))) return candidate;
  }
  return null;
}

/**
 * 用 LLM 根据显示名生成 agent ID（语义化优先，冲突加序号而非直接丢弃）。
 *
 * 策略三段式：
 *   1. LLM 音译 → sanitize → 作为 base
 *   2. LLM 失败 / 洗完无效 → 用 name 自己 sanitize 做 base（兜底仍保留语义）
 *   3. base 拿到后探测 base / base-2 / ... / base-99，找到空位就用
 *   4. 上述全失败 → 时间戳兜底 `agent-xxxxxx`（几乎不可能冲突，再兜底一次防万一）
 *
 * @param {object} utilConfig
 * @param {string} name - 显示名
 * @param {string} agentsDir - agents 根目录（检查冲突）
 */
export async function generateAgentId(utilConfig, name, agentsDir) {
  let base = "";
  // ID 生成只是顺手做个音译，LLM 慢/不可用都不该阻塞创建：
  // 短超时后立刻走本地 slug + 时间戳兜底。
  const startedAt = Date.now();
  try {
    const lang = normalizePromptLang(getLocale());
    const execution = callTextConfigFromUtilityConfig(utilConfig);
    const text = await callLlm({
      ...execution,
      timeoutMs: 15_000,
      messages: [
        {
          role: "system",
          content: pickPromptText(lang, {
            zh: `根据给定的助手名字，生成一个简短的英文小写 ID（用于文件夹名）。
规则：
1. 纯小写英文字母，可以用连字符
2. 2~12 个字符
3. 尽量是名字的英文音译或缩写
4. 直接输出 ID，不要解释

示例：
- "花子" → "jarvis"
- "ミク" → "miku"
- "小助手" → "helper"
- "Alice" → "alice"`,
            ja: `与えられたアシスタント名から、フォルダ名用の短い小文字英語 ID を生成してください。
ルール:
1. 小文字の英字のみ、ハイフン使用可
2. 2〜12 文字
3. 名前の英語の音訳または略語を優先すること
4. 説明なしで ID のみを出力すること

例:
- "花子" → "jarvis"
- "ミク" → "miku"
- "ヘルパー" → "helper"
- "Alice" → "alice"`,
            ko: `주어진 어시스턴트 이름으로 폴더명용 짧은 소문자 영어 ID를 생성하세요.
규칙:
1. 소문자 영어만 사용, 하이픈 허용
2. 2~12자
3. 이름의 영어 음역 또는 약어를 우선할 것
4. 설명 없이 ID만 출력할 것

예시:
- "花子" → "jarvis"
- "ミク" → "miku"
- "도우미" → "helper"
- "Alice" → "alice"`,
            fr: `À partir du nom d'assistant fourni, génère un identifiant anglais court en minuscules (pour un nom de dossier).
Règles :
1. Lettres anglaises minuscules uniquement, tirets autorisés
2. 2 à 12 caractères
3. Préférer une translittération ou abréviation du nom en anglais
4. Sors uniquement l'identifiant, sans explication

Exemples :
- "花子" → "jarvis"
- "ミク" → "miku"
- "Helper" → "helper"
- "Alice" → "alice"`,
            de: `Erzeuge aus dem angegebenen Assistentennamen eine kurze kleingeschriebene englische ID (als Ordnername).
Regeln:
1. Nur kleingeschriebene englische Buchstaben, Bindestriche erlaubt
2. 2-12 Zeichen
3. Bevorzuge eine Transliteration oder Abkürzung des Namens auf Englisch
4. Gib nur die ID aus, ohne Erklärung

Beispiele:
- "花子" → "jarvis"
- "ミク" → "miku"
- "Helfer" → "helper"
- "Alice" → "alice"`,
            en: `Given an assistant's display name, generate a short lowercase English ID (for use as a folder name).
Rules:
1. Lowercase English letters only, hyphens allowed
2. 2–12 characters
3. Prefer a transliteration or abbreviation of the name
4. Output the ID directly, no explanation

Examples:
- "花子" → "jarvis"
- "ミク" → "miku"
- "Helper" → "helper"
- "Alice" → "alice"`,
          }),
        },
        { role: "user", content: name },
      ],
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "generate_agent_id", "manual"),
    });

    base = sanitizeAgentId(text);
  } catch (err) {
    // 超时/失败都只打一条 warn：这是创建链路最常见的耗时点，
    // 后续兜底 ID 不影响创建成功。
    log.warn(`generateAgentId LLM failed after ${Date.now() - startedAt}ms: ${formatError(err)}`);
  }

  // LLM 失败或洗完太短 → 用 name 自己做 slug（比时间戳兜底更有语义）
  if (base.length < 2) {
    base = sanitizeAgentId(name);
  }

  if (base.length >= 2) {
    const available = findAvailableAgentId(base, agentsDir);
    if (available) return available;
  }

  // 最终兜底：时间戳 id（几乎不可能冲突，再兜一次防御极端时序）
  let ts = `agent-${Date.now().toString(36)}`;
  while (fs.existsSync(path.join(agentsDir, ts))) {
    ts = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
  }
  return ts;
}

/**
 * 为 agent 生成能力描述摘要
 * @param {object} utilConfig - resolveUtilityConfig() 返回值
 * @param {string} personality - Agent.descriptionSource 全文（identity + ishiki，不含 yuan 运行协议）
 * @param {string} locale - agent 的 config.locale（"zh" / "en" 等）
 * @returns {Promise<string|null>}
 */
export async function generateDescription(utilConfig, personality, locale) {
  try {
    const execution = callTextConfigFromUtilityConfig(utilConfig);
    if (!execution.model || !execution.baseUrl || !execution.api) return null;

    const lang = normalizePromptLang(locale);
    const systemContent = pickPromptText(lang, {
      zh: "你是产品花名册的第三方编辑。根据以下 AI agent 的公开人格材料，写一段第三人称简介。目标约 100 字，可在 60-200 字之间自然浮动。要求：像介绍一位助手，而不是替助手自述；涵盖人格特征、专长领域、沟通风格、适合的任务类型；不要使用第一人称；不要输出 <mood>、Vibe、Sparks、Pulse、Reflect 或任何内部标签。纯文本，不要用 markdown 格式。直接输出简介，不要解释。",
      ja: "あなたは製品カタログのサードパーティ編集者です。以下の AI エージェントの公開ペルソナ資料をもとに、三人称の紹介文を書いてください。目標は約 100 字で、60〜200 字の範囲で自然に調整します。要件: アシスタント自身の自己紹介ではなく、外部から紹介する視点で書くこと。人格的な特徴、得意分野、コミュニケーションスタイル、適したタスクの種類を網羅すること。一人称は使わないこと。<mood>、Vibe、Sparks、Pulse、Reflect などの内部タグを出力しないこと。プレーンテキストで、markdown は使わないこと。説明なしで紹介文のみを出力すること。",
      ko: "당신은 제품 로스터의 서드파티 편집자입니다. 아래 AI 에이전트의 공개 페르소나 자료를 바탕으로 3인칭 소개문을 작성하세요. 목표는 약 100자이며 60-200자 범위에서 자연스럽게 조정합니다. 요구사항: 어시스턴트의 자기소개가 아니라 외부에서 소개하는 시점으로 쓸 것. 성격 특징, 전문 분야, 커뮤니케이션 스타일, 적합한 작업 유형을 다룰 것. 1인칭을 사용하지 말 것. <mood>, Vibe, Sparks, Pulse, Reflect 등 내부 태그를 출력하지 말 것. 일반 텍스트로 작성하고 markdown을 사용하지 말 것. 설명 없이 소개문만 출력할 것.",
      fr: "Tu es un rédacteur tiers pour le catalogue produit. À partir du matériau de persona public ci-dessous, rédige une description de cet agent IA à la troisième personne. Vise environ 100 caractères ; 60 à 200 caractères sont acceptables. Décris l'assistant de l'extérieur, jamais à la première personne. Couvre les traits de personnalité, les domaines d'expertise, le style de communication et les types de tâches adaptés. N'emploie pas la première personne. Ne sors pas <mood>, Vibe, Sparks, Pulse, Reflect ni aucune balise interne. Texte brut, sans markdown. Sors la description directement, sans explication.",
      de: "Du bist ein Drittanbieter-Redakteur für den Produktkatalog. Verfasse auf Basis des öffentlichen Personamaterials unten eine Beschreibung dieses KI-Agenten in der dritten Person. Ziel etwa 100 Zeichen; 60-200 Zeichen sind akzeptabel. Beschreibe den Assistenten von außen, nicht in der ersten Person. Decke Persönlichkeitsmerkmale, Fachgebiete, Kommunikationsstil und geeignete Aufgabentypen ab. Keine erste Person. Gib nicht <mood>, Vibe, Sparks, Pulse, Reflect oder andere interne Tags aus. Reiner Text, kein Markdown. Gib die Beschreibung direkt aus, ohne Erklärung.",
      en: "You are a third-person product roster editor. Based on the public persona material below, write a public-facing description of this AI agent. Aim for about 100 characters; 60-200 characters is acceptable. Describe the assistant from the outside, not in first person. Cover personality traits, expertise, communication style, and suitable tasks. Do not output <mood>, Vibe, Sparks, Pulse, Reflect, or any internal tags. Plain text, no markdown. Output the description directly, no explanation.",
    });

    const raw = await callLlm({
      ...execution,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: personality.slice(0, 3000) },
      ],
      temperature: 0.3,
      lengthContract: localeLengthContract(lang, {
        zh: { label: "简介", target: 100, unit: "chars", min: 1 },
        en: { label: "description", target: 100, unit: "chars", min: 1 },
        ja: { label: "紹介文", target: 100, unit: "chars", min: 1 },
        ko: { label: "소개", target: 100, unit: "chars", min: 1 },
        fr: { label: "description", target: 100, unit: "chars", min: 1 },
        de: { label: "Beschreibung", target: 100, unit: "chars", min: 1 },
      }),
      usageLedger: utilConfig.usageLedger,
      usageContext: utilityUsageContext(utilConfig, "generate_description", "manual"),
    });
    if (!raw) return null;

    const text = normalizePlainDescription(raw);
    return text || null;
  } catch (err) {
    log.error(`generateDescription failed: ${formatError(err)}`);
    return null;
  }
}
