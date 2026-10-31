// SPDX-FileCopyrightText: 2024-Present Contributors to BitJarvis
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'package:bitjarvis/services/translation_service.dart';
import 'package:flutter_test/flutter_test.dart';
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

  group('GatewayTranslationProvider', () {
    test('converts the host channel payload into a TranslationResult', () async {
      final provider = GatewayTranslationProvider(
        call: (text, target) async => {
          'translatedText': '你好',
          'detectedSourceLanguage': 'en',
          'targetLanguage': target,
        },
      );

      final result = await provider.translate('Hello', 'zh');

      expect(result.translatedText, '你好');
      expect(result.detectedSourceLanguage, 'en');
      expect(result.targetLanguage, 'zh');
    });

    test('throws when the host is unavailable (standalone mode)', () async {
      final provider = GatewayTranslationProvider(
        call: (text, target) async => null,
      );

      expect(
        () => provider.translate('Hello', 'zh'),
        throwsA(isA<TranslationException>()),
      );
    });

    test('throws when the host returns empty text', () async {
      final provider = GatewayTranslationProvider(
        call: (text, target) async => {'translatedText': ''},
      );

      expect(
        () => provider.translate('Hello', 'zh'),
        throwsA(isA<TranslationException>()),
      );
    });
  });

  group('TranslationService', () {
    test('rejects empty messages', () async {
      final service = TranslationService(provider: _FakeProvider());

      expect(
        () => service.translate('event', '   ', 'zh'),
        throwsA(isA<TranslationException>()),
      );
    });

    test('serves repeated requests from the cache', () async {
      final provider = _FakeProvider();
      final service = TranslationService(provider: provider);

      final first = await service.translate('event', 'Hello', 'zh');
      final second = await service.translate('event', 'Hello again', 'zh');

      expect(provider.calls, 1);
      expect(second.translatedText, first.translatedText);
      expect(service.getCached('event', 'zh')?.translatedText, '你好');
      expect(service.getAnyCached('event')?.translatedText, '你好');
    });

    test('restores cached translations from the settings store', () async {
      final provider = _FakeProvider();
      await TranslationService(provider: provider)
          .translate('event', 'Hello', 'zh');

      final restored = TranslationService(provider: _FakeProvider());
      await restored.preloadCache(await SharedPreferences.getInstance());

      expect(restored.getAnyCached('event')?.translatedText, '你好');
      await restored.translate('event', 'Hello', 'zh');
    });

    test('removeTranslation clears memory and persistent cache', () async {
      final provider = _FakeProvider();
      final service = TranslationService(provider: provider);
      await service.translate('event', 'Hello', 'zh');

      await service.removeTranslation('event');
      expect(service.getAnyCached('event'), isNull);

      final restored = TranslationService(provider: _FakeProvider());
      await restored.preloadCache(await SharedPreferences.getInstance());
      expect(restored.getAnyCached('event'), isNull);
    });

    test('languageName maps known codes and falls back to upper case', () {
      expect(TranslationService.languageName('zh'), '中文');
      expect(TranslationService.languageName('en'), 'English');
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