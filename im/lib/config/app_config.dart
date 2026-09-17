// SPDX-FileCopyrightText: 2019-Present Christian Kußowski
// SPDX-FileCopyrightText: 2019-Present Contributors to FluffyChat
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'dart:ui';

abstract class AppConfig {
  static const Color primaryColor = Color(0xFF261386);

  static const Color chatColor = primaryColor;
  static const double messageFontSize = 16.0;
  static const bool allowOtherHomeservers = true;
  static const bool enableRegistration = true;
  static const bool hideTypingUsernames = false;

  static const String defaultHomeserver = 'bitjarvis.chat';

  static const String inviteLinkPrefix = 'https://bitjarvis.chat/#/';
  static String inviteLink(String? mxid) => mxid == null ? inviteLinkPrefix : '$inviteLinkPrefix$mxid';
  static const String deepLinkPrefix = 'im.bitjarvis://chat/';
  static const String schemePrefix = 'matrix:';
  static const String pushNotificationsChannelId = 'bitjarvis_push';
  static const String pushNotificationsAppId = 'chat.fluffy.bitjarvis';
  static const double borderRadius = 18.0;
  static const double spaceBorderRadius = 11.0;
  static const double columnWidth = 360.0;

  static const String enablePushTutorial =
      'https://bitjarvis.chat/faq/#push_without_google_services';
  static const String encryptionTutorial =
      'https://bitjarvis.chat/faq/#how_to_use_end_to_end_encryption';
  static const String startChatTutorial =
      'https://bitjarvis.chat/faq/#how_do_i_find_other_users';
  static const String howDoIGetStickersTutorial =
      'https://bitjarvis.chat/faq/#how_do_i_get_stickers';
  static const String appId = 'im.bitjarvis.BitJarvis';
  static const String appOpenUrlScheme = 'im.bitjarvis';
  static const String appSsoUrlScheme = 'im.bitjarvis.auth';

  static const String sourceCodeUrl =
      'https://github.com/mengtian999/bitjarvis';
  static const String supportUrl =
      'https://github.com/mengtian999/bitjarvis/issues';
  static const String changelogUrl = 'https://bitjarvis.chat/changelog/';
  static const String helpUrl =
      'https://bitjarvis.chat/faq/#how_can_i_support_bitjarvis';

  static const Set<String> defaultReactions = {'👍', '❤️', '😂', '😮', '😢'};

  static final Uri newIssueUrl = Uri(
    scheme: 'https',
    host: 'github.com',
    path: '/mengtian999/bitjarvis/issues/new',
  );

  static final Uri homeserverList = Uri(
    scheme: 'https',
    host: 'raw.githubusercontent.com',
    path: 'mengtian999/bitjarvis/refs/heads/main/recommended_homeservers.json',
  );

  /// Bundled copy of the public homeserver list, used as a fallback when
  /// [homeserverList] cannot be fetched (e.g. a private repository answers 404).
  static const String recommendedHomeserversAsset =
      'assets/recommended_homeservers.json';

  static const String mainIsolatePortName = 'main_isolate';
  static const String pushIsolatePortName = 'push_isolate';
  static const String pushHelperCrashReportKey = 'push_helper_crash_report';
}
