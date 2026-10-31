// SPDX-FileCopyrightText: 2024-Present Contributors to BitJarvis
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'dart:convert';

import 'package:bitjarvis/utils/agent_bridge.dart';
import 'package:matrix/matrix_api_lite/utils/logs.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Thrown when a translation request cannot be fulfilled.
class TranslationException implements Exception {
  final String message;

  const TranslationException(this.message);

  @override
  String toString() => message;
}

/// Result of a translation operation.
class TranslationResult {
  final String translatedText;
  final String detectedSourceLanguage;
  final String targetLanguage;

  const TranslationResult({
    required this.translatedText,
    required this.detectedSourceLanguage,
    required this.targetLanguage,
  });

  Map<String, dynamic> toJson() => {
        'translatedText': translatedText,
        'detectedSourceLanguage': detectedSourceLanguage,
        'targetLanguage': targetLanguage,
      };

  factory TranslationResult.fromJson(Map<String, dynamic> json) =>
      TranslationResult(
        translatedText: json['translatedText'] as String,
        detectedSourceLanguage: json['detectedSourceLanguage'] as String,
        targetLanguage: json['targetLanguage'] as String,
      );
}

/// Abstract translation service contract.
abstract class TranslationProvider {
  /// Translate [text] to [targetLanguage] (BCP-47 code, e.g. 'en', 'zh', 'ja').
  Future<TranslationResult> translate(String text, String targetLanguage);
}

/// Translates via the Jarvis gateway's hidden `im_translate` tier.
///
/// The IM never holds a gateway API key or URL. It asks the native host
/// (Electron / Android / iOS) over the `agent_bridge` MethodChannel to perform
/// the call; the host already possesses the device identity and calls
/// `POST /v1/chat/completions` with `model="im_translate"`. In standalone mode
/// (no host registered on the channel) [AgentBridge.translate] returns null
/// and this provider throws a friendly [TranslationException].
class GatewayTranslationProvider implements TranslationProvider {
  /// The channel call used to reach the host. Injectable for tests.
  final Future<Map<String, dynamic>?> Function(String text, String targetLanguage)
      call;

  GatewayTranslationProvider({this.call = AgentBridge.translate});

  @override
  Future<TranslationResult> translate(
    String text,
    String targetLanguage,
  ) async {
    final raw = await call(text, targetLanguage);
    if (raw == null) {
      throw const TranslationException('翻译需要 Jarvis 网关，当前环境不可用');
    }
    final translated = raw['translatedText'] as String? ?? '';
    if (translated.isEmpty) {
      throw const TranslationException('翻译返回为空');
    }
    return TranslationResult(
      translatedText: translated,
      detectedSourceLanguage: (raw['detectedSourceLanguage'] as String?) ?? '',
      targetLanguage: (raw['targetLanguage'] as String?) ?? targetLanguage,
    );
  }
}

/// Languages offered in the settings UI, using their native names.
const Map<String, String> translationSupportedLanguages = {
  'zh': '中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
  'fr': 'Français',
  'de': 'Deutsch',
  'es': 'Español',
  'pt': 'Português',
  'ru': 'Русский',
  'it': 'Italiano',
  'nl': 'Nederlands',
  'pl': 'Polski',
  'tr': 'Türkçe',
  'ar': 'العربية',
  'hi': 'हिन्दी',
  'th': 'ไทย',
  'vi': 'Tiếng Việt',
  'id': 'Bahasa Indonesia',
};

/// Display name of a language code, falling back to the upper cased code.
String translationLanguageName(String code) =>
    translationSupportedLanguages[code] ?? code.toUpperCase();

/// Translation service with memory and disk caching.
///
/// Provider is fixed to the Jarvis gateway ([GatewayTranslationProvider]);
/// users never configure an API key. The only user-facing setting is the
/// target language (default: follow the system locale).
class TranslationService {
  /// Maximum number of translations kept in the cache.
  static const int maxCacheEntries = 500;

  /// Languages offered in the settings UI (alias for the top-level constant).
  static Map<String, String> get supportedLanguages =>
      translationSupportedLanguages;

  /// Display name of a language code (alias for the top-level function).
  static String languageName(String code) => translationLanguageName(code);

  static const String _cachePrefix = 'translation_cache_';
  static const String _targetLanguageKey = 'translation_target_language';

  final TranslationProvider _provider;
  final Map<String, TranslationResult> _memoryCache = {};

  TranslationService({TranslationProvider? provider})
      : _provider = provider ?? GatewayTranslationProvider();

  /// The user's preferred target language, defaulting to system locale.
  static String getTargetLanguage(
    SharedPreferences prefs,
    String systemLocale,
  ) {
    final stored = getStoredTargetLanguage(prefs);
    if (stored != null) return stored;
    return systemLocale.split('_').first.split('-').first;
  }

  /// The explicitly configured target language, or null to follow the system.
  static String? getStoredTargetLanguage(SharedPreferences prefs) {
    final stored = prefs.getString(_targetLanguageKey);
    return (stored == null || stored.isEmpty) ? null : stored;
  }

  /// Save the user's preferred target language. Empty means system default.
  static Future<void> setTargetLanguage(
    SharedPreferences prefs,
    String language,
  ) async {
    if (language.isEmpty) {
      await prefs.remove(_targetLanguageKey);
      return;
    }
    await prefs.setString(_targetLanguageKey, language);
  }

  /// Preload cached translations from disk into memory (call at app/chat init).
  Future<void> preloadCache(SharedPreferences prefs) async {
    for (final prefKey in prefs.getKeys().toList()) {
      if (!prefKey.startsWith(_cachePrefix)) continue;
      final key = prefKey.substring(_cachePrefix.length);
      if (_memoryCache.containsKey(key)) continue;
      final raw = prefs.getString(prefKey);
      if (raw == null) continue;
      try {
        _memoryCache[key] = TranslationResult.fromJson(
          json.decode(raw) as Map<String, dynamic>,
        );
      } catch (e) {
        Logs().w('Failed to parse cached translation', e);
        await prefs.remove(prefKey);
      }
    }
  }

  /// Cached translation for an event and target language, if any.
  TranslationResult? getCached(String eventId, String targetLanguage) =>
      _memoryCache['$eventId:$targetLanguage'];

  /// Any cached translation for an event, regardless of the language.
  TranslationResult? getAnyCached(String eventId) {
    final prefix = '$eventId:';
    for (final entry in _memoryCache.entries) {
      if (entry.key.startsWith(prefix)) return entry.value;
    }
    return null;
  }

  /// Translate text for a given event, using cache when available.
  Future<TranslationResult> translate(
    String eventId,
    String text,
    String targetLanguage,
  ) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) {
      throw const TranslationException('Nothing to translate');
    }

    final key = '$eventId:$targetLanguage';
    final cached = _memoryCache[key];
    if (cached != null) return cached;

    final prefs = await SharedPreferences.getInstance();
    final diskCached = prefs.getString('$_cachePrefix$key');
    if (diskCached != null) {
      try {
        final result = TranslationResult.fromJson(
          json.decode(diskCached) as Map<String, dynamic>,
        );
        _memoryCache[key] = result;
        return result;
      } catch (e) {
        Logs().w('Failed to parse cached translation', e);
        await prefs.remove('$_cachePrefix$key');
      }
    }

    final result = await _provider.translate(trimmed, targetLanguage);
    await _storeInCache(prefs, key, result);
    return result;
  }

  Future<void> _storeInCache(
    SharedPreferences prefs,
    String key,
    TranslationResult result,
  ) async {
    _memoryCache[key] = result;
    await prefs.setString('$_cachePrefix$key', json.encode(result.toJson()));
    await _pruneCache(prefs);
  }

  Future<void> _pruneCache(SharedPreferences prefs) async {
    if (_memoryCache.length <= maxCacheEntries) return;
    final excess = _memoryCache.length - maxCacheEntries;
    final keysToRemove = _memoryCache.keys.take(excess).toList();
    for (final key in keysToRemove) {
      _memoryCache.remove(key);
      await prefs.remove('$_cachePrefix$key');
    }
  }

  /// Remove cached translations of an event from memory and disk.
  Future<void> removeTranslation(String eventId) async {
    final prefix = '$eventId:';
    final memoryKeys =
        _memoryCache.keys.where((key) => key.startsWith(prefix)).toList();
    for (final key in memoryKeys) {
      _memoryCache.remove(key);
    }
    final prefs = await SharedPreferences.getInstance();
    for (final prefKey in prefs.getKeys().toList()) {
      if (!prefKey.startsWith(_cachePrefix)) continue;
      if (prefKey.substring(_cachePrefix.length).startsWith(prefix)) {
        await prefs.remove(prefKey);
      }
    }
  }

  /// Clear all translations from memory cache.
  void clearMemoryCache() => _memoryCache.clear();
}