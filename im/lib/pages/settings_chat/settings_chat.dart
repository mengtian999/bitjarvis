// SPDX-FileCopyrightText: 2019-Present Christian Kußowski
// SPDX-FileCopyrightText: 2019-Present Contributors to FluffyChat
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'package:bitjarvis/config/setting_keys.dart';
import 'package:bitjarvis/services/translation_service.dart';
import 'package:flutter/material.dart';

import 'settings_chat_view.dart';

class SettingsChat extends StatefulWidget {
  const SettingsChat({super.key});

  @override
  SettingsChatController createState() => SettingsChatController();
}

class SettingsChatController extends State<SettingsChat> {
  final TranslationService _translationService = TranslationService();

  String? translationProviderType;
  bool hasTranslationApiKey = false;

  @override
  void initState() {
    super.initState();
    _loadTranslationSettings();
  }

  void updateState() => setState(() {});

  Future<void> _loadTranslationSettings() async {
    final prefs = AppSettings.store;
    final apiKey = await _translationService.loadApiKey(prefs: prefs);
    if (!mounted) return;
    setState(() {
      translationProviderType = TranslationService.getProviderType(prefs);
      hasTranslationApiKey = apiKey != null && apiKey.isNotEmpty;
    });
  }

  /// The explicitly configured target language, empty when following system.
  String get storedTargetLanguage =>
      TranslationService.getStoredTargetLanguage(AppSettings.store) ?? '';

  Future<void> setTranslationProvider(String? type) async {
    final prefs = AppSettings.store;
    if (type == null) {
      await _translationService.clearProviderConfig(prefs);
    } else {
      final apiKey = await _translationService.loadApiKey(prefs: prefs) ?? '';
      await _translationService.saveProviderConfig(
        prefs,
        type: type,
        apiKey: apiKey,
      );
    }
    await _loadTranslationSettings();
  }

  Future<void> setTranslationApiKey(String apiKey) async {
    final type = translationProviderType;
    if (type == null) return;
    await _translationService.saveProviderConfig(
      AppSettings.store,
      type: type,
      apiKey: apiKey.trim(),
    );
    await _loadTranslationSettings();
  }

  Future<void> setTranslationTargetLanguage(String language) async {
    await TranslationService.setTargetLanguage(AppSettings.store, language);
    await _loadTranslationSettings();
  }

  @override
  Widget build(BuildContext context) => SettingsChatView(this);
}
