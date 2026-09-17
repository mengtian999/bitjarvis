/**
 * 五语种语音目录(简体中文/繁體中文/日本語/한국어/English)。
 *
 * 单一数据源,供三方使用:
 * - lib/providers/microsoft-speech.ts:Edge TTS provider 静态声明的音色列表
 * - core/tts/adapters.ts、core/speech-recognition/adapters.ts:按语言选默认音色/SSML 语言/本地模型目录
 * - 桌面端设置「语音」页:语言选择、音色过滤、试听示例句
 *
 * Edge TTS 在线覆盖全部五语种(免费、无需 Key);sherpa-onnx 本地引擎按目录就绪情况
 * 提供子集(zh/en/ja 走 kokoro 或 vits,ko 走 mimic3,ASR 走 SenseVoice 多语种单模型)。
 */

export type SpeechLanguageId = "zh-CN" | "zh-TW" | "ja" | "ko" | "en";

export interface SpeechVoiceOption {
  /** Edge TTS voice 名,如 zh-CN-XiaoxiaoNeural。 */
  id: string;
  label: string;
  gender: "female" | "male";
}

export interface SpeechLanguageEntry {
  id: SpeechLanguageId;
  /** 中性展示名(UI 优先用 i18n key,缺失时回退此值)。 */
  label: string;
  /** Edge SSML xml:lang。 */
  ssmlLang: string;
  /** Edge 在线音色(策划 2–3 个/语种)。 */
  edgeVoices: SpeechVoiceOption[];
  edgeDefaultVoice: string;
  /** sherpa-onnx 本地 TTS 模型目录名(models/tts/ 下);null 表示该语种无本地方案。 */
  sherpaTtsModelDir: string | null;
  /** kokoro 多语种模型的 speaker id(zh/en/ja);非 kokoro 模型为 null。 */
  sherpaKokoroVoice: string | null;
  /** sherpa-onnx 本地 ASR 模型目录名(models/asr/ 下)。 */
  sherpaAsrModelDir: string;
  /** 设置页试听示例句。 */
  sampleText: string;
}

export const SPEECH_LANGUAGES: SpeechLanguageEntry[] = [
  {
    id: "zh-CN",
    label: "简体中文",
    ssmlLang: "zh-CN",
    edgeVoices: [
      { id: "zh-CN-XiaoxiaoNeural", label: "晓晓", gender: "female" },
      { id: "zh-CN-YunxiNeural", label: "云希", gender: "male" },
      { id: "zh-CN-XiaoyiNeural", label: "晓伊", gender: "female" },
      { id: "zh-CN-YunxiaNeural", label: "云霞", gender: "female" },
      { id: "zh-CN-YunyangNeural", label: "云扬", gender: "male" },
      { id: "zh-CN-YunjianNeural", label: "云健", gender: "male" },
      { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北", gender: "female" },
    ],
    edgeDefaultVoice: "zh-CN-XiaoxiaoNeural",
    sherpaTtsModelDir: "zh",
    sherpaKokoroVoice: null,
    sherpaAsrModelDir: "sense-voice",
    sampleText: "你好，我是你的语音助手，很高兴为你服务。",
  },
  {
    id: "zh-TW",
    label: "繁體中文",
    ssmlLang: "zh-TW",
    edgeVoices: [
      { id: "zh-TW-HsiaoChenNeural", label: "曉臻", gender: "female" },
      { id: "zh-TW-YunJheNeural", label: "雲哲", gender: "male" },
    ],
    edgeDefaultVoice: "zh-TW-HsiaoChenNeural",
    sherpaTtsModelDir: "zh",
    sherpaKokoroVoice: null,
    sherpaAsrModelDir: "sense-voice",
    sampleText: "你好，我是你的語音助手，很高興為你服務。",
  },
  {
    id: "ja",
    label: "日本語",
    ssmlLang: "ja-JP",
    edgeVoices: [
      { id: "ja-JP-NanamiNeural", label: "七海", gender: "female" },
      { id: "ja-JP-KeitaNeural", label: "圭太", gender: "male" },
    ],
    edgeDefaultVoice: "ja-JP-NanamiNeural",
    sherpaTtsModelDir: "kokoro-multi",
    sherpaKokoroVoice: "jf_alpha",
    sherpaAsrModelDir: "sense-voice",
    sampleText: "こんにちは、音声アシスタントです。ご用件をお聞かせください。",
  },
  {
    id: "ko",
    label: "한국어",
    ssmlLang: "ko-KR",
    edgeVoices: [
      { id: "ko-KR-SunHiNeural", label: "선히", gender: "female" },
      { id: "ko-KR-InJoonNeural", label: "인준", gender: "male" },
    ],
    edgeDefaultVoice: "ko-KR-SunHiNeural",
    sherpaTtsModelDir: "ko",
    sherpaKokoroVoice: null,
    sherpaAsrModelDir: "sense-voice",
    sampleText: "안녕하세요, 음성 비서입니다. 무엇을 도와드릴까요?",
  },
  {
    id: "en",
    label: "English",
    ssmlLang: "en-US",
    edgeVoices: [
      { id: "en-US-AriaNeural", label: "Aria", gender: "female" },
      { id: "en-US-GuyNeural", label: "Guy", gender: "male" },
      { id: "en-US-JennyNeural", label: "Jenny", gender: "female" },
      { id: "en-US-AvaNeural", label: "Ava", gender: "female" },
      { id: "en-US-ChristopherNeural", label: "Christopher", gender: "male" },
      { id: "en-US-EricNeural", label: "Eric", gender: "male" },
      { id: "en-US-MichelleNeural", label: "Michelle", gender: "female" },
      { id: "en-US-RogerNeural", label: "Roger", gender: "male" },
      { id: "en-US-SteffanNeural", label: "Steffan", gender: "male" },
      { id: "en-US-AnaNeural", label: "Ana", gender: "female" },
      { id: "en-US-AndrewNeural", label: "Andrew", gender: "male" },
      { id: "en-US-EmmaNeural", label: "Emma", gender: "female" },
      { id: "en-US-AvaMultilingualNeural", label: "Ava（多语言）", gender: "female" },
    ],
    edgeDefaultVoice: "en-US-AriaNeural",
    sherpaTtsModelDir: "kokoro-multi",
    sherpaKokoroVoice: "af_sarah",
    sherpaAsrModelDir: "sense-voice",
    sampleText: "Hello, this is your voice assistant. How can I help you today?",
  },
];

export const DEFAULT_SPEECH_LANGUAGE: SpeechLanguageId = "zh-CN";

const BY_ID = new Map(SPEECH_LANGUAGES.map((entry) => [entry.id, entry]));

export function getSpeechLanguage(id: unknown): SpeechLanguageEntry | null {
  return typeof id === "string" ? BY_ID.get(id as SpeechLanguageId) || null : null;
}

/** UI locale(zh/zh-CN/zh-TW/ja/ko/en/…)→ 语音语言;未知回退简体中文。 */
export function resolveSpeechLanguageFromLocale(locale: unknown): SpeechLanguageEntry {
  if (typeof locale !== "string" || !locale.trim()) return BY_ID.get(DEFAULT_SPEECH_LANGUAGE)!;
  const normalized = locale.trim().replace("_", "-").toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-cn") || normalized.startsWith("zh-hans")) return BY_ID.get("zh-CN")!;
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hant") || normalized.startsWith("zh-hk")) return BY_ID.get("zh-TW")!;
  if (normalized.startsWith("ja")) return BY_ID.get("ja")!;
  if (normalized.startsWith("ko")) return BY_ID.get("ko")!;
  if (normalized.startsWith("en")) return BY_ID.get("en")!;
  return BY_ID.get(DEFAULT_SPEECH_LANGUAGE)!;
}

/** 依据语言取默认 Edge 音色;未知语言回退简体中文默认。 */
export function defaultEdgeVoiceForLanguage(language: unknown): string {
  return (getSpeechLanguage(language) || BY_ID.get(DEFAULT_SPEECH_LANGUAGE)!).edgeDefaultVoice;
}

/** 从 Edge voice 名推导 SSML xml:lang,如 zh-CN-liaoning-XiaobeiNeural → zh-CN。 */
export function voiceToSsmlLang(voice: unknown): string {
  if (typeof voice !== "string" || !voice.trim()) return "en-US";
  const parts = voice.trim().split("-");
  if (parts.length < 2 || !/^[a-z]{2}$/i.test(parts[0]) || !/^[a-z]{2,3}$/i.test(parts[1])) {
    const entry = BY_ID.get(DEFAULT_SPEECH_LANGUAGE)!;
    return entry.ssmlLang;
  }
  return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
}

/** 依据 voice 名反查语种(如 zh-TW-HsiaoChenNeural → zh-TW);未知返回 null。 */
export function findLanguageByVoice(voice: unknown): SpeechLanguageEntry | null {
  if (typeof voice !== "string" || !voice.trim()) return null;
  const ssmlLang = voiceToSsmlLang(voice);
  return SPEECH_LANGUAGES.find((entry) => entry.ssmlLang === ssmlLang) || null;
}

/** 平铺的全部 Edge 音色(供 provider 静态声明使用)。 */
export function allEdgeVoices(): SpeechVoiceOption[] {
  return SPEECH_LANGUAGES.flatMap((entry) => entry.edgeVoices);
}
