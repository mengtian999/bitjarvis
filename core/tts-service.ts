/**
 * TtsService — 文本转语音（speech generation）。
 * 对标 SpeechRecognitionService：按 provider/model 选择适配器合成音频。
 */
import { MediaAdapterRegistry } from "./media-adapter-registry.ts";
import { builtinTtsAdapters } from "./tts/adapters.ts";
import { resolveSpeechLanguageFromLocale } from "./speech/speech-languages.ts";
import { createModuleLogger } from "../lib/debug-log.ts";
import fs from "node:fs";

const CAPABILITY = "speech_generation";
// 默认回退到 Microsoft Edge TTS：免费、在线、无需本地引擎或 API Key，开箱即用。
// 用户可在设置中切换到 sherpa-onnx 本地引擎。
const FALLBACK_DEFAULT_MODEL = { provider: "microsoft-edge", id: "edge-tts" };
const log = createModuleLogger("tts");

function textOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class TtsService {
  declare _emitEvent: any;
  declare _fetch: any;
  declare _logger: any;
  declare _prefs: any;
  declare _providers: any;
  declare _registry: any;

  constructor({ providerRegistry, preferences, emitEvent, fetch, logger = log, adapters = builtinTtsAdapters }: any = {}) {
    if (!providerRegistry) throw new Error("TtsService requires providerRegistry");
    if (!preferences) throw new Error("TtsService requires preferences");
    this._providers = providerRegistry;
    this._prefs = preferences;
    this._emitEvent = typeof emitEvent === "function" ? emitEvent : () => {};
    this._fetch = fetch;
    this._logger = logger;
    this._registry = new MediaAdapterRegistry();
    for (const adapter of adapters || []) this.registerAdapter(adapter);
  }
registerAdapter(adapter) { this._registry.register(adapter); }

  unregisterAdapter(adapterId) { this._registry.unregister(adapterId); }

  hasAdapterForModel(providerId, model) {
    if (!model?.protocolId) return false;
    return Boolean(this._registry.getProtocol(model.protocolId) || this._registry.get(providerId));
  }

  listProviders() {
    const next: any = {};
    for (const provider of this._providers.getMediaProviders(CAPABILITY) || []) {
      const providerId = provider.providerId;
      const models = (provider.models || [])
        .map((model) => ({ ...model, adapterAvailable: this.hasAdapterForModel(providerId, model) }))
        .filter((model) => model.adapterAvailable);
      if (!models.length) continue;
      const credentialStatus = this._providers.getMediaProviderCredentialStatus?.(providerId, CAPABILITY) || {};
      next[providerId] = {
        ...provider,
        ...credentialStatus,
        models,
        availableModels: models.map((model) => ({ id: model.id, name: model.displayName || model.name || model.id })),
      };
    }
    return { providers: next, config: this.getConfig() };
  }
getConfig() {
    return this._prefs.getTtsConfig?.() || { enabled: false };
  }

  setConfig(patch) {
    const next = normalizeTtsConfigPatch(patch, this.getConfig());
    if (next.defaultModel) {
      const listed = this.listProviders().providers;
      const provider = listed[next.defaultModel.provider];
      if (!provider?.models?.some((model) => model.id === next.defaultModel.id)) {
        throw new Error("text-to-speech default model is unavailable");
      }
    }
    return this._prefs.setTtsConfig?.(next) || next;
  }

  /** 语言解析末级回退:跟随界面语言(preferences locale),发音人随之取该语言默认。 */
  _resolveDefaultLanguage() {
    try {
      const locale = typeof this._prefs?.getLocale === "function" ? this._prefs.getLocale() : null;
      return locale ? resolveSpeechLanguageFromLocale(locale).id : null;
    } catch { return null; }
  }
  async synthesize(payload: any = {}) {
    const { text, voice, rate, language, providerId, provider, modelId, model } = payload;
    const config = this.getConfig();
    const defaultModel = config.defaultModel || FALLBACK_DEFAULT_MODEL;
    const targetProvider = textOrNull(providerId || provider) || defaultModel?.provider || null;
    const targetModel = textOrNull(modelId || model) || defaultModel?.id || null;
    const targetLanguage = textOrNull(language) || textOrNull(config.language) || this._resolveDefaultLanguage();
    const resolvedVoice = textOrNull(voice) || textOrNull(config.voice) || null;
    if (!text || typeof text !== "string" || !text.trim()) throw new Error("text is required for text-to-speech");
    if (!targetProvider || !targetModel) throw new Error("text-to-speech model is not configured");

    const target = this._providers.resolveMediaModel({ providerId: targetProvider, modelId: targetModel, capability: CAPABILITY });
    const adapter = this._registry.getProtocol(target.model.protocolId) || this._registry.get(target.providerId);
    if (!adapter?.synthesize) throw new Error(`No TTS adapter registered for protocol "${target.model.protocolId}"`);

    const credentialProviderId = target.credentialLane?.providerId || target.providerId;
    const credentials = this._providers.getCredentials(credentialProviderId) || {};
    const localSpeech = this._prefs.getSherpaConfig?.() || null;

let result;
    try {
      result = await adapter.synthesize({
        text: text.trim(),
        provider: target.provider,
        model: target.model,
        credentials,
        voice: resolvedVoice,
        rate,
        language: targetLanguage,
        localSpeech,
        fetch: this._fetch,
      });
    } catch (err) {
      this._logger?.warn?.(`tts synthesize failed for ${targetProvider}/${target.model?.id || targetModel}: ${err?.message || err}`);
      throw new Error(err?.message || String(err));
    }

    return {
      text: text.trim(),
      providerId: target.providerId,
      modelId: target.model.id,
      protocolId: target.model.protocolId,
      ...(voice ? { voice } : {}),
      ...(config.enabled ? { enabled: true } : {}),
      audio: normalizeAudioResult(result?.audio),
    };
  }

  /** Stream synthesis: calls onChunk for each audio chunk, onDone when finished.
   *  Promise resolves on stream completion and rejects when the adapter reports
   *  an error (including errors surfaced asynchronously from WS events). */
  async synthesizeStream(payload, onChunk, onDone) {
    const text = payload.text;
    const voice = payload.voice;
    const rate = payload.rate;
    const providerId = payload.providerId || payload.provider;
    const modelId = payload.modelId || payload.model;
    const config = this.getConfig();
    const defaultModel = config.defaultModel || FALLBACK_DEFAULT_MODEL;
    const targetProvider = textOrNull(providerId) || defaultModel?.provider || null;
    const targetModel = textOrNull(modelId) || defaultModel?.id || null;
    const targetLanguage = textOrNull(payload.language) || textOrNull(config.language) || this._resolveDefaultLanguage();
    const resolvedVoice = textOrNull(payload.voice) || textOrNull(config.voice) || null;
    if (!text || !targetProvider || !targetModel) throw new Error('TTS is not configured');
    const target = this._providers.resolveMediaModel({ providerId: targetProvider, modelId: targetModel, capability: CAPABILITY });
    const adapter = this._registry.getProtocol(target.model.protocolId) || this._registry.get(target.providerId);
    if (!adapter?.streamSynthesize) throw new Error('No streaming TTS adapter for ' + target.model.protocolId);
    const credentialProviderId = target.credentialLane?.providerId || target.providerId;
    const credentials = this._providers.getCredentials(credentialProviderId) || {};
    const localSpeech = this._prefs.getSherpaConfig?.() || null;
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (settleFn, value) => {
          if (settled) return;
          settled = true;
          settleFn(value);
        };
        let pending;
        try {
          pending = adapter.streamSynthesize({
            text: text.trim(),
            provider: target.provider,
            model: target.model,
            credentials,
            voice: resolvedVoice,
            rate,
            language: targetLanguage,
            localSpeech,
            fetch: this._fetch,
          },
          (chunk) => {
            try { onChunk(chunk); } catch (err) { settle(reject, err); }
          },
          () => settle(resolve, undefined),
          (err) => settle(reject, err));
        } catch (err) {
          settle(reject, err);
          return;
        }
        // adapter 可能不返回 Promise(事件驱动);若返回则兜住其异步 rejection
        if (pending && typeof pending.catch === "function") pending.catch((err) => settle(reject, err));
      });
    } catch (err) {
      this._logger?.warn?.('tts stream failed: ' + (err?.message || err));
      throw err;
    }
  }
}
function normalizeAudioResult(audio: any = {}) {
  if (!audio || typeof audio !== "object") throw new Error("tts adapter returned no audio");
  if (typeof audio.dataUrl === "string" && audio.dataUrl) return { dataUrl: audio.dataUrl };
  if (typeof audio.data === "string" && audio.data) {
    return { dataUrl: `data:${audio.mimeType || "audio/mpeg"};base64,${audio.data}` };
  }
  if (typeof audio.filePath === "string" && audio.filePath) {
    let raw;
    try {
      raw = fs.readFileSync(audio.filePath);
    } finally {
      if (audio.transient === true) {
        try { fs.rmSync(audio.filePath, { force: true }); } catch { /* ignore */ }
      }
    }
    return { dataUrl: `data:${audio.mimeType || "audio/wav"};base64,${raw.toString("base64")}` };
  }
  throw new Error("tts adapter returned unusable audio");
}

function normalizeTtsConfigPatch(patch, current: any = {}) {
  const body = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(body, "enabled")) next.enabled = body.enabled === true;
  if (Object.prototype.hasOwnProperty.call(body, "defaultModel")) {
    const value = body.defaultModel;
    if (value === null || value === undefined) {
      delete next.defaultModel;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const provider = typeof value.provider === "string" ? value.provider.trim() : "";
      const id = typeof value.id === "string" ? value.id.trim() : "";
      if (!provider || !id) throw new Error("tts.defaultModel requires provider and id");
      next.defaultModel = { provider, id };
    } else {
      throw new Error("tts.defaultModel must be an object");
    }
  }
  if (typeof body.voice === "string" && body.voice.trim()) next.voice = body.voice.trim();
  else if (Object.prototype.hasOwnProperty.call(body, "voice") && (body.voice === null || body.voice === undefined)) delete next.voice;
  if (body.rate !== undefined && body.rate !== null) next.rate = body.rate;
  if (typeof body.language === "string" && body.language.trim()) next.language = body.language.trim();
  else if (Object.prototype.hasOwnProperty.call(body, "language") && (body.language === null || body.language === undefined)) delete next.language;
  return {
    enabled: next.enabled === true,
    ...(next.defaultModel ? { defaultModel: next.defaultModel } : {}),
    ...(next.voice ? { voice: next.voice } : {}),
    ...(next.rate !== undefined ? { rate: next.rate } : {}),
    ...(next.language ? { language: next.language } : {}),
  };
}
