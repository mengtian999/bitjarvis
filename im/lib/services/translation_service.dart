// SPDX-FileCopyrightText: 2024-Present Contributors to BitJarvis
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:matrix/matrix_api_lite/utils/logs.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Timeout applied to every translation request.
const Duration translationRequestTimeout = Duration(seconds: 20);

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

Future<http.Response> _postJson(
  http.Client? client,
  Uri uri,
  Map<String, String> headers,
  Map<String, dynamic> body,
) {
  final httpClient = client ?? http.Client();
  final request = httpClient
      .post(uri, headers: headers, body: json.encode(body))
      .timeout(translationRequestTimeout);
  if (client != null) return request;
  return request.whenComplete(httpClient.close);
}

/// Google Cloud Translation API v2 implementation.
class GoogleTranslationProvider implements TranslationProvider {
  final String apiKey;
  final http.Client? client;

  GoogleTranslationProvider({required this.apiKey, this.client});

  @override
  Future<TranslationResult> translate(
    String text,
    String targetLanguage,
  ) async {
    final uri = Uri.parse(
      'https://translation.googleapis.com/language/translate/v2',
    );
    final response = await _postJson(
      client,
      uri,
      {'Content-Type': 'application/json'},
      {
        'q': text,
        'target': targetLanguage,
        'format': 'text',
        'key': apiKey,
      },
    );

    if (response.statusCode != 200) {
      throw TranslationException(
        'Google Translation API error: ${response.statusCode} ${response.body}',
      );
    }

    final data = json.decode(response.body) as Map<String, dynamic>;
    final translations =
        ((data['data'] as Map<String, dynamic>)['translations'] as List)
            .first as Map<String, dynamic>;

    return TranslationResult(
      translatedText: translations['translatedText'] as String,
      detectedSourceLanguage:
          (translations['detectedSourceLanguage'] as String?) ?? '',
      targetLanguage: targetLanguage,
    );
  }
}

/// DeepL API implementation.
class DeepLTranslationProvider implements TranslationProvider {
  final String apiKey;
  final bool useFreeApi;
  final http.Client? client;

  DeepLTranslationProvider({
    required this.apiKey,
    this.useFreeApi = true,
    this.client,
  });

  @override
  Future<TranslationResult> translate(
    String text,
    String targetLanguage,
  ) async {
    final host = useFreeApi ? 'api-free.deepl.com' : 'api.deepl.com';
    final uri = Uri.parse('https://$host/v2/translate');
    final response = await _postJson(
      client,
      uri,
      {
        'Authorization': 'DeepL-Auth-Key $apiKey',
        'Content-Type': 'application/json',
      },
      {
        'text': [text],
        'target_lang': targetLanguage.toUpperCase(),
      },
    );

    if (response.statusCode != 200) {
      throw TranslationException(
        'DeepL API error: ${response.statusCode} ${response.body}',
      );
    }

    final data = json.decode(response.body) as Map<String, dynamic>;
    final translation =
        (data['translations'] as List).first as Map<String, dynamic>;

    return TranslationResult(
      translatedText: translation['text'] as String,
      detectedSourceLanguage:
          (translation['detected_source_language'] as String?) ?? '',
      targetLanguage: targetLanguage,
    );
  }
}

/// Translation service with memory and disk caching plus provider settings.
class TranslationService {
  static const String providerGoogle = 'google';
  static const String providerDeepl = 'deepl';
  static const String providerDeeplPro = 'deepl_pro';

  /// Languages offered in the settings UI, using their native names.
  static const Map<String, String> supportedLanguages = {
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

  /// Maximum number of translations kept in the cache.
  static const int maxCacheEntries = 500;

  static const String _cachePrefix = 'translation_cache_';
  static const String _providerTypeKey = 'translation_provider_type';
  static const String _providerApiKeyKey = 'translation_api_key';
  static const String _targetLanguageKey = 'translation_target_language';

  final FlutterSecureStorage _secureStorage;
  final http.Client? _client;
  final Map<String, TranslationResult> _memoryCache = {};

  TranslationProvider? _provider;
  String? _providerType;

  TranslationService({FlutterSecureStorage? secureStorage, http.Client? client})
      : _secureStorage = secureStorage ?? const FlutterSecureStorage(),
        _client = client;

  /// Display name of a language code, falling back to the upper cased code.
  static String languageName(String code) =>
      supportedLanguages[code] ?? code.toUpperCase();

  /// Inject a provider directly, e.g. for tests or custom integrations.
  void configure(TranslationProvider provider, {String? type}) {
    _provider = provider;
    _providerType = type ?? _providerType;
  }

  /// Initialize the provider from the given settings and load cached results.
  Future<void> initFromSettings(SharedPreferences prefs) async {
    final type = prefs.getString(_providerTypeKey);
    final apiKey = await loadApiKey(prefs: prefs);
    _providerType = type;

    if (type == null || apiKey == null || apiKey.isEmpty) {
      _provider = null;
    } else {
      _provider = _createProvider(type, apiKey);
    }

    await _loadCacheFromPrefs(prefs);
  }

  TranslationProvider? _createProvider(String type, String apiKey) {
    switch (type) {
      case providerGoogle:
        return GoogleTranslationProvider(apiKey: apiKey, client: _client);
      case providerDeepl:
        return DeepLTranslationProvider(apiKey: apiKey, client: _client);
      case providerDeeplPro:
        return DeepLTranslationProvider(
          apiKey: apiKey,
          useFreeApi: false,
          client: _client,
        );
      default:
        return null;
    }
  }

  /// Whether a translation provider is configured.
  bool get isConfigured => _provider != null;

  /// The configured provider type, if any.
  String? get providerType => _providerType;

  /// Reads the configured provider type from the settings.
  static String? getProviderType(SharedPreferences prefs) =>
      prefs.getString(_providerTypeKey);

  /// Get the user's preferred target language, defaulting to system locale.
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

  /// Read the API key, preferring the platform secure storage.
  Future<String?> loadApiKey({SharedPreferences? prefs}) async {
    try {
      final secure = await _secureStorage.read(key: _providerApiKeyKey);
      if (secure != null && secure.isNotEmpty) return secure;
    } catch (e) {
      Logs().w('Unable to read translation API key from secure storage', e);
    }
    final store = prefs ?? await SharedPreferences.getInstance();
    return store.getString(_providerApiKeyKey);
  }

  /// Save provider configuration, storing the API key in secure storage.
  Future<void> saveProviderConfig(
    SharedPreferences prefs, {
    required String type,
    required String apiKey,
  }) async {
    await prefs.setString(_providerTypeKey, type);
    await prefs.remove(_providerApiKeyKey);
    try {
      await _secureStorage.write(key: _providerApiKeyKey, value: apiKey);
    } catch (e) {
      Logs().w('Unable to store translation API key in secure storage', e);
      await prefs.setString(_providerApiKeyKey, apiKey);
    }
    _providerType = type;
    _provider = apiKey.isEmpty ? null : _createProvider(type, apiKey);
  }

  /// Remove the provider configuration and the stored API key.
  Future<void> clearProviderConfig(SharedPreferences prefs) async {
    await prefs.remove(_providerTypeKey);
    await prefs.remove(_providerApiKeyKey);
    try {
      await _secureStorage.delete(key: _providerApiKeyKey);
    } catch (e) {
      Logs().w('Unable to delete translation API key from secure storage', e);
    }
    _providerType = null;
    _provider = null;
  }

  /// Get cached translation result for an event and target language.
  TranslationResult? getCached(String eventId, String targetLanguage) =>
      _memoryCache['$eventId:$targetLanguage'];

  /// Get any cached translation for an event, regardless of the language.
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

    final provider = _provider;
    if (provider == null) {
      throw const TranslationException('Translation provider not configured');
    }

    final result = await provider.translate(trimmed, targetLanguage);
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

  Future<void> _loadCacheFromPrefs(SharedPreferences prefs) async {
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

  /// Remove cached translations of an event from memory and disk.
  Future<void> removeTranslation(
    String eventId, {
    String? targetLanguage,
  }) async {
    final prefix = targetLanguage == null
        ? '$eventId:'
        : '$eventId:$targetLanguage';
    final memoryKeys = _memoryCache.keys
        .where((key) => key.startsWith(prefix))
        .toList();
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