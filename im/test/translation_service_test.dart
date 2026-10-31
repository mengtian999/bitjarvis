// SPDX-FileCopyrightText: 2024-Present Contributors to BitJarvis
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'dart:convert';

import 'package:bitjarvis/services/translation_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeProvider implements TranslationProvider {
  int calls = 0;

  @override
  Future<TranslationResult> translate(
    String text,
    String targetLanguage,
  ) async {
    calls++;
    return TranslationResult(
      translatedText: '你好',
      detectedSourceLanguage: 'en',
      targetLanguage: targetLanguage,
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('GoogleTranslationProvider', () {
    test('sends the request and parses the response', () async {
      late Map<String, dynamic> requestBody;
      final client = MockClient((request) async {
        requestBody = json.decode(request.body) as Map<String, dynamic>;
        return http.Response(
          json.encode({
            'data': {
              'translations': [
                {'translatedText': '你好', 'detectedSourceLanguage': 'en'},
              ],
            },
          }),
          200,
        );
      });

      final provider = GoogleTranslationProvider(
        apiKey: 'api-key',
        client: client,
      );
      final result = await provider.translate('Hello', 'zh');

      expect(requestBody['q'], 'Hello');
      expect(requestBody['target'], 'zh');
      expect(requestBody['key'], 'api-key');
      expect(result.translatedText, '你好');
      expect(result.detectedSourceLanguage, 'en');
      expect(result.targetLanguage, 'zh');
    });

    test('throws a TranslationException on error responses', () async {
      final client = MockClient(
        (request) async => http.Response('quota exceeded', 403),
      );
      final provider = GoogleTranslationProvider(
        apiKey: 'api-key',
        client: client,
      );

      expect(
        () => provider.translate('Hello', 'zh'),
        throwsA(isA<TranslationException>()),
      );
    });
  });

  group('DeepLTranslationProvider', () {
    test('uppercases the target language and parses the response', () async {
      late Map<String, dynamic> requestBody;
      final client = MockClient((request) async {
        requestBody = json.decode(request.body) as Map<String, dynamic>;
        return http.Response(
          json.encode({
            'translations': [
              {'detected_source_language': 'EN', 'text': '你好'},
            ],
          }),
          200,
        );
      });

      final provider = DeepLTranslationProvider(
        apiKey: 'api-key',
        client: client,
      );
      final result = await provider.translate('Hello', 'zh');

      expect(requestBody['target_lang'], 'ZH');
      expect(result.translatedText, '你好');
      expect(
        TranslationService.languageName(
          result.detectedSourceLanguage.toLowerCase(),
        ),
        '中文',
      );
    });
  });

  group('TranslationService', () {
    test('throws when no provider is configured', () async {
      final service = TranslationService();

      expect(
        () => service.translate('event', 'Hello', 'zh'),
        throwsA(isA<TranslationException>()),
      );
    });

    test('rejects empty messages', () async {
      final service = TranslationService()..configure(_FakeProvider());

      expect(
        () => service.translate('event', '   ', 'zh'),
        throwsA(isA<TranslationException>()),
      );
    });

    test('serves repeated requests from the cache', () async {
      final provider = _FakeProvider();
      final service = TranslationService()..configure(provider);

      final first = await service.translate('event', 'Hello', 'zh');
      final second = await service.translate('event', 'Hello again', 'zh');

      expect(provider.calls, 1);
      expect(second.translatedText, first.translatedText);
      expect(service.getCached('event', 'zh')?.translatedText, '你好');
      expect(service.getAnyCached('event')?.translatedText, '你好');
    });

    test('restores cached translations from the settings store', () async {
      final provider = _FakeProvider();
      final service = TranslationService()..configure(provider);
      await service.translate('event', 'Hello', 'zh');

      final restored = TranslationService();
      await restored.initFromSettings(
        await SharedPreferences.getInstance(),
      );

      expect(restored.isConfigured, isFalse);
      expect(restored.getAnyCached('event')?.translatedText, '你好');
      await restored.translate('event', 'Hello', 'zh');
      expect(provider.calls, 1);
    });

    test('removeTranslation clears memory and persistent cache', () async {
      final service = TranslationService()..configure(_FakeProvider());
      await service.translate('event', 'Hello', 'zh');

      await service.removeTranslation('event');
      expect(service.getAnyCached('event'), isNull);

      final restored = TranslationService();
      await restored.initFromSettings(
        await SharedPreferences.getInstance(),
      );
      expect(restored.getAnyCached('event'), isNull);
    });

    test('languageName falls back to the upper cased code', () {
      expect(TranslationService.languageName('zh'), '中文');
      expect(TranslationService.languageName('xx'), 'XX');
    });
  });

  group('settings helpers', () {
    test('target language defaults to the system language', () async {
      final prefs = await SharedPreferences.getInstance();

      expect(TranslationService.getTargetLanguage(prefs, 'zh_CN'), 'zh');
      expect(TranslationService.getStoredTargetLanguage(prefs), isNull);

      await TranslationService.setTargetLanguage(prefs, 'ja');
      expect(TranslationService.getTargetLanguage(prefs, 'en_US'), 'ja');

      await TranslationService.setTargetLanguage(prefs, '');
      expect(TranslationService.getTargetLanguage(prefs, 'en_US'), 'en');
    });
  });
}