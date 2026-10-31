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
  /// Cached copy of the stored target language (empty = follow system).
  String _storedTargetLanguage = '';
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _refreshTargetLanguage();
  }

  void updateState() => setState(() {});

  /// The explicitly configured target language, empty when following system.
  String get storedTargetLanguage => _storedTargetLanguage;

  bool get loaded => _loaded;

  Future<void> _refreshTargetLanguage() async {
    final prefs = AppSettings.store;
    final stored = TranslationService.getStoredTargetLanguage(prefs) ?? '';
    if (!mounted) return;
    setState(() {
      _storedTargetLanguage = stored;
      _loaded = true;
    });
  }

  Future<void> setTranslationTargetLanguage(String language) async {
    await TranslationService.setTargetLanguage(AppSettings.store, language);
    await _refreshTargetLanguage();
  }

  @override
  Widget build(BuildContext context) => SettingsChatView(this);
}