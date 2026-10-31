// SPDX-FileCopyrightText: 2019-Present Christian Kußowski
// SPDX-FileCopyrightText: 2019-Present Contributors to FluffyChat
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:bitjarvis/config/setting_keys.dart';
import 'package:bitjarvis/config/themes.dart';
import 'package:bitjarvis/l10n/l10n.dart';
import 'package:bitjarvis/services/translation_service.dart';
import 'package:bitjarvis/utils/adaptive_bottom_sheet.dart';
import 'package:bitjarvis/utils/platform_infos.dart';
import 'package:bitjarvis/widgets/adaptive_dialogs/show_text_input_dialog.dart';
import 'package:bitjarvis/widgets/layouts/max_width_body.dart';
import 'package:bitjarvis/widgets/matrix.dart';
import 'package:bitjarvis/widgets/settings_switch_list_tile.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'settings_chat.dart';

class SettingsChatView extends StatelessWidget {
  final SettingsChatController controller;
  const SettingsChatView(this.controller, {super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(L10n.of(context).chat),
        automaticallyImplyLeading: !FluffyThemes.isColumnMode(context),
        centerTitle: FluffyThemes.isColumnMode(context),
      ),
      body: ListTileTheme(
        iconColor: theme.textTheme.bodyLarge!.color,
        child: MaxWidthBody(
          child: Column(
            children: [
              SettingsSwitchListTile.adaptive(
                title: L10n.of(context).formattedMessages,
                subtitle: L10n.of(context).formattedMessagesDescription,
                setting: AppSettings.renderHtml,
              ),
              SettingsSwitchListTile.adaptive(
                title: L10n.of(context).hideRedactedMessages,
                subtitle: L10n.of(context).hideRedactedMessagesBody,
                setting: AppSettings.hideRedactedEvents,
              ),
              SettingsSwitchListTile.adaptive(
                title: L10n.of(context).hideRoomsInSpaces,
                setting: AppSettings.hideRoomsInSpaces,
              ),
              SettingsSwitchListTile.adaptive(
                title: L10n.of(context).hideInvalidOrUnknownMessageFormats,
                setting: AppSettings.hideUnknownEvents,
              ),
              if (PlatformInfos.isMobile)
                SettingsSwitchListTile.adaptive(
                  title: L10n.of(context).autoplayImages,
                  setting: AppSettings.autoplayImages,
                ),
              SettingsSwitchListTile.adaptive(
                title: L10n.of(context).sendOnEnter,
                setting: AppSettings.sendOnEnter,
              ),
              SettingsSwitchListTile.adaptive(
                title: L10n.of(context).swipeRightToLeftToReply,
                setting: AppSettings.swipeRightToLeftToReply,
              ),
              SettingsSwitchListTile.adaptive(
                title: L10n.of(context).showThumbnailsInTimeline,
                setting: AppSettings.showThumbnailsInTimeline,
              ),
              SettingsSwitchListTile.adaptive(
                title: L10n.of(context).doubleTapToReact,
                subtitle: L10n.of(context).doubleTapToReactDescription,
                setting: AppSettings.doubleTapToReact,
                onChanged: (_) => controller.updateState(),
              ),
              if (AppSettings.doubleTapToReact.value)
                ListTile(
                  title: Text(L10n.of(context).doubleTapReaction),
                  trailing: Text(
                    AppSettings.doubleTapReaction.value,
                    style: const TextStyle(fontSize: 24),
                  ),
                  onTap: () async {
                    final emoji = await showAdaptiveBottomSheet<String>(
                      context: context,
                      builder: (context) => Scaffold(
                        appBar: AppBar(
                          title: Text(L10n.of(context).doubleTapReaction),
                          leading: CloseButton(
                            onPressed: () => Navigator.of(context).pop(null),
                          ),
                        ),
                        body: SizedBox(
                          height: double.infinity,
                          child: EmojiPicker(
                            onEmojiSelected: (_, emoji) =>
                                Navigator.of(context).pop(emoji.emoji),
                            config: Config(
                              locale: Localizations.localeOf(context),
                              emojiViewConfig: const EmojiViewConfig(
                                backgroundColor: Colors.transparent,
                              ),
                              bottomActionBarConfig:
                                  const BottomActionBarConfig(enabled: false),
                              categoryViewConfig: CategoryViewConfig(
                                initCategory: Category.SMILEYS,
                                backspaceColor: theme.colorScheme.primary,
                                iconColor: theme.colorScheme.primary.withAlpha(
                                  128,
                                ),
                                iconColorSelected: theme.colorScheme.primary,
                                indicatorColor: theme.colorScheme.primary,
                                backgroundColor: theme.colorScheme.surface,
                              ),
                              skinToneConfig: SkinToneConfig(
                                dialogBackgroundColor: Color.lerp(
                                  theme.colorScheme.surface,
                                  theme.colorScheme.primaryContainer,
                                  0.75,
                                )!,
                                indicatorColor: theme.colorScheme.onSurface,
                              ),
                            ),
                          ),
                        ),
                      ),
                    );
                    if (emoji != null) {
                      await AppSettings.doubleTapReaction.setItem(emoji);
                      controller.updateState();
                    }
                  },
                ),
              Divider(color: theme.dividerColor),
              ListTile(
                title: Text(
                  L10n.of(context).translationSettings,
                  style: TextStyle(
                    color: theme.colorScheme.secondary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                subtitle: Text(
                  L10n.of(context).translationSettingsDescription,
                ),
              ),
              ListTile(
                title: Text(L10n.of(context).translationProvider),
                subtitle: Text(
                  _providerLabel(context, controller.translationProviderType),
                ),
                trailing: const Icon(Icons.chevron_right_outlined),
                onTap: () => _selectProvider(context),
              ),
              if (controller.translationProviderType != null)
                ListTile(
                  title: Text(L10n.of(context).translationApiKey),
                  subtitle: Text(
                    controller.hasTranslationApiKey
                        ? '••••••••'
                        : L10n.of(context).translationNotConfiguredShort,
                  ),
                  trailing: const Icon(Icons.chevron_right_outlined),
                  onTap: () => _editApiKey(context),
                ),
              ListTile(
                title: Text(L10n.of(context).translationTargetLanguage),
                subtitle: Text(_targetLanguageLabel(context)),
                trailing: const Icon(Icons.chevron_right_outlined),
                onTap: () => _selectTargetLanguage(context),
              ),
              Divider(color: theme.dividerColor),
              ListTile(
                title: Text(
                  L10n.of(context).customEmojisAndStickers,
                  style: TextStyle(
                    color: theme.colorScheme.secondary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              ListTile(
                title: Text(L10n.of(context).customEmojisAndStickers),
                subtitle: Text(L10n.of(context).customEmojisAndStickersBody),
                onTap: () => context.go('/rooms/settings/chat/emotes'),
                trailing: const Padding(
                  padding: EdgeInsets.all(16.0),
                  child: Icon(Icons.chevron_right_outlined),
                ),
              ),
              Divider(color: theme.dividerColor),
              ListTile(
                title: Text(
                  L10n.of(context).calls,
                  style: TextStyle(
                    color: theme.colorScheme.secondary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              SettingsSwitchListTile.adaptive(
                title: L10n.of(context).experimentalVideoCalls,
                onChanged: (b) {
                  Matrix.of(context).createVoipPlugin();
                  return;
                },
                setting: AppSettings.experimentalVoip,
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _providerLabel(BuildContext context, String? type) {
    switch (type) {
      case TranslationService.providerGoogle:
        return 'Google Cloud Translation';
      case TranslationService.providerDeepl:
        return 'DeepL (Free)';
      case TranslationService.providerDeeplPro:
        return 'DeepL (Pro)';
      default:
        return L10n.of(context).translationProviderOff;
    }
  }

  String _systemLanguageCode(BuildContext context) =>
      Localizations.localeOf(context).languageCode;

  String _targetLanguageLabel(BuildContext context) {
    final stored = controller.storedTargetLanguage;
    if (stored.isEmpty) {
      return L10n.of(context).translationLanguageAuto(
        TranslationService.languageName(_systemLanguageCode(context)),
      );
    }
    return TranslationService.languageName(stored);
  }

  Future<void> _selectProvider(BuildContext context) async {
    const offValue = '_off_';
    final entries = <String, String>{
      offValue: L10n.of(context).translationProviderOff,
      TranslationService.providerGoogle: 'Google Cloud Translation',
      TranslationService.providerDeepl: 'DeepL (Free)',
      TranslationService.providerDeeplPro: 'DeepL (Pro)',
    };
    final current = controller.translationProviderType ?? offValue;
    final selected = await showAdaptiveBottomSheet<String>(
      context: context,
      builder: (context) => Scaffold(
        appBar: AppBar(
          title: Text(L10n.of(context).translationProvider),
          leading: CloseButton(onPressed: () => Navigator.of(context).pop()),
        ),
        body: ListView(
          children: [
            for (final entry in entries.entries)
              ListTile(
                leading: Icon(
                  entry.key == current
                      ? Icons.radio_button_checked
                      : Icons.radio_button_off,
                ),
                title: Text(entry.value),
                onTap: () => Navigator.of(context).pop(entry.key),
              ),
          ],
        ),
      ),
    );
    if (selected == null) return;
    await controller.setTranslationProvider(
      selected == offValue ? null : selected,
    );
  }

  Future<void> _editApiKey(BuildContext context) async {
    final apiKey = await showTextInputDialog(
      context: context,
      title: L10n.of(context).translationApiKey,
      hintText: L10n.of(context).translationApiKeyHint,
      obscureText: true,
      autocorrect: false,
      validator: (input) =>
          input.trim().isEmpty ? L10n.of(context).translationApiKeyHint : null,
    );
    if (apiKey == null) return;
    await controller.setTranslationApiKey(apiKey);
  }

  Future<void> _selectTargetLanguage(BuildContext context) async {
    final systemLanguage = _systemLanguageCode(context);
    final selected = await showAdaptiveBottomSheet<String>(
      context: context,
      builder: (context) => Scaffold(
        appBar: AppBar(
          title: Text(L10n.of(context).translationTargetLanguage),
          leading: CloseButton(onPressed: () => Navigator.of(context).pop()),
        ),
        body: ListView(
          children: [
            ListTile(
              leading: const Icon(Icons.language),
              title: Text(
                L10n.of(context).translationLanguageAuto(
                  TranslationService.languageName(systemLanguage),
                ),
              ),
              trailing: controller.storedTargetLanguage.isEmpty
                  ? const Icon(Icons.check)
                  : null,
              onTap: () => Navigator.of(context).pop(''),
            ),
            for (final entry in TranslationService.supportedLanguages.entries)
              ListTile(
                title: Text('${entry.value} (${entry.key})'),
                trailing: controller.storedTargetLanguage == entry.key
                    ? const Icon(Icons.check)
                    : null,
                onTap: () => Navigator.of(context).pop(entry.key),
              ),
          ],
        ),
      ),
    );
    if (selected == null) return;
    await controller.setTranslationTargetLanguage(selected);
  }
}
