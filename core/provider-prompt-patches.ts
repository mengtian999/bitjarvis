/**
 * Temporary provider prompt patches.
 *
 * Deletion condition:
 * Remove this module when DeepSeek reasoning models reliably keep user-facing
 * answers in final assistant content across official and third-party providers.
 */

import { isDeepSeekFamilyModel, isDeepSeekReasoningModel } from "../shared/model-capabilities.ts";
import { normalizePromptLang, pickPromptText } from "../shared/prompt-locale.ts";

function isThinkingOff(level) {
  return level === "off" || level === "none" || level === "disabled";
}

function deepseekOutputContractPrompt(locale) {
  const lang = normalizePromptLang(String(locale || ""));
  if (lang !== "zh" && lang !== "zh-TW") {
    return pickPromptText(lang, {
      ja: [
        "DeepSeek モデルを使用している場合は、以下の DeepSeek 出力契約に従ってください：",
        "reasoning_content / thinking は内部の推論下書き専用です。",
        "ユーザーに見せる回答・提案・コード・リスト・質問・要約・結論は、思考終了後の最終 assistant content に書くこと。",
        "reasoning_content / thinking のみで応答を終えないこと。",
        "<think> タグを使う場合は、最終回答の前に思考タグを閉じること。",
      ].join("\n"),
      ko: [
        "DeepSeek 모델을 사용하는 경우 다음 DeepSeek 출력 계약을 따를 것:",
        "reasoning_content / thinking은 내부 추론 초고용으로만 사용.",
        "사용자에게 보여줄 답변, 제안, 코드, 목록, 질문, 요약, 결론은 반드시 생각이 끝난 후 최종 assistant content에 작성.",
        "reasoning_content / thinking만으로 응답을 끝내지 말 것.",
        "<think> 태그를 사용한 경우 최종 답변 전에 태그를 닫을 것.",
      ].join("\n"),
      fr: [
        "Si tu utilises un modèle DeepSeek, respecte ce contrat de sortie DeepSeek :",
        "reasoning_content / thinking sert uniquement de brouillon de raisonnement privé.",
        "Toute réponse, recommandation, code, liste, question, résumé ou conclusion destiné(e) à l'utilisateur doit être écrit(e) dans le contenu final de l'assistant après la réflexion.",
        "Ne termine pas une réponse uniquement avec reasoning_content / thinking.",
        "Si tu utilises des balises <think>, ferme la balise de réflexion avant de produire la réponse finale.",
      ].join("\n"),
      de: [
        "Wenn du ein DeepSeek-Modell verwendest, halte diesen DeepSeek-Ausgabevertrag ein:",
        "reasoning_content / thinking ist nur für private Denkvorarbeiten.",
        "Jede benutzergerichtete Antwort, Empfehlung, jeder Code, jede Liste, Frage, Zusammenfassung oder Schlussfolgerung muss nach dem Denken in den finalen Assistant-Content geschrieben werden.",
        "Beende eine Antwort nicht nur mit reasoning_content / thinking.",
        "Wenn du <think>-Tags verwendest, schließe das Denk-Tag, bevor du die finale Antwort ausgibst.",
      ].join("\n"),
      en: [
        "If you are using a DeepSeek model, follow this DeepSeek output contract:",
        "reasoning_content / thinking is only for private reasoning scratch work.",
        "Any user-facing answer, recommendation, code, list, question, summary, or conclusion must be written into the final assistant content after thinking.",
        "Do not end a response with only reasoning_content / thinking.",
        "If you use <think> tags, close the thinking tag before emitting the final answer.",
      ].join("\n"),
    });
  }

  return [
    "如果你使用的是 DeepSeek 模型，请遵守以下 DeepSeek 输出契约：",
    "reasoning_content / thinking 只用于内部推理草稿。",
    "任何需要展示给用户的回答、建议、代码、列表、问题、摘要、结论，都必须在思考结束后写入最终 assistant content。",
    "不要只输出 reasoning_content / thinking 就结束本轮回复。",
    "如果使用 <think> 标签，必须先关闭思考标签，再输出最终回答。",
  ].join("\n");
}

export function getProviderPromptPatches(model, options: { reasoningLevel?: any; locale?: any } = {}) {
  if (isThinkingOff(options.reasoningLevel)) return [];
  if (!isDeepSeekReasoningModel(model)) return [];
  return [deepseekOutputContractPrompt(options.locale)];
}

export const _test = {
  isDeepSeekFamilyModel,
  isDeepSeekReasoningModel,
};
