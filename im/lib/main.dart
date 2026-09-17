// SPDX-FileCopyrightText: 2019-Present Christian Kußowski
// SPDX-FileCopyrightText: 2019-Present Contributors to FluffyChat
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'dart:convert';
import 'dart:isolate';
import 'dart:ui';

import 'package:app_links/app_links.dart';
import 'package:collection/collection.dart';
import 'package:bitjarvis/config/app_config.dart';
import 'package:bitjarvis/utils/client_manager.dart';
import 'package:bitjarvis/utils/notification_background_handler.dart';
import 'package:bitjarvis/utils/platform_infos.dart';
import 'package:bitjarvis/utils/start_push_foreground_service.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_vodozemac/flutter_vodozemac.dart' as vod;
import 'package:matrix/matrix.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:universal_html/universal_html.dart' as web;

import 'config/setting_keys.dart';
import 'utils/background_push.dart';
import 'widgets/fluffy_chat_app.dart';

ReceivePort? mainIsolateReceivePort;

bool _vodozemacInitialized = false;

bool isIntegrationTest = false;

void main(List<String> args) async {
  isIntegrationTest = args.singleOrNull == 'integration_test';
  if (PlatformInfos.isAndroid) {
    final port = mainIsolateReceivePort = ReceivePort();
    IsolateNameServer.removePortNameMapping(AppConfig.mainIsolatePortName);
    IsolateNameServer.registerPortWithName(
      port.sendPort,
      AppConfig.mainIsolatePortName,
    );
    await waitForPushIsolateDone();
  }

  // Sanitize hash for OIDC:
  if (kIsWeb) {
    final hash = web.window.location.hash;
    if (hash.isNotEmpty && !hash.startsWith('/')) {
      web.window.location.hash = hash.replaceFirst('#', '#?');
    }
  }

  // Our background push shared isolate accesses flutter-internal things very early in the startup proccess
  // To make sure that the parts of flutter needed are started up already, we need to ensure that the
  // widget bindings are initialized already.
  WidgetsFlutterBinding.ensureInitialized();

  // Desktop deep link handling (Windows/macOS/Linux):
  // Listens for im.bitjarvis:// URIs so the app can be woken up
  // from share links like https://bitjarvis.chat/#/@user:bitjarvis.chat.
  if (!kIsWeb && !PlatformInfos.isMobile) {
    final appLinks = AppLinks();
    appLinks.getInitialLink().then(_handleDeepLink);
    appLinks.uriLinkStream.listen(_handleDeepLink);
  }

  final store = await AppSettings.init();
  Logs().i('Welcome to ${AppSettings.applicationName.value} <3');

  kEnableMatrixSdkBenchmarks = AppSettings.benchmarksInLogs.value;

  if (!_vodozemacInitialized) {
    await vod.init(wasmPath: './assets/assets/vodozemac/');
    _vodozemacInitialized = true;
  }

  Logs().nativeColors = !PlatformInfos.isIOS;

  // If the app starts in detached mode, we assume that it is in
  // background fetch mode for processing push notifications. This is
  // currently only supported on Android.
  if (PlatformInfos.isAndroid &&
      AppLifecycleState.detached == WidgetsBinding.instance.lifecycleState) {
    await ForegroundServices.startService('background_push');

    final clients = await ClientManager.getClients(store: store);

    // Do not send online presences when app is in background fetch mode.
    for (final client in clients) {
      client.backgroundSync = false;
      client.syncPresence = PresenceType.offline;
    }

    // In the background fetch mode we do not want to waste ressources with
    // starting the Flutter engine but process incoming push notifications.
    BackgroundPush.clientOnly(clients);
    // To start the flutter engine afterwards we add an custom observer.
    WidgetsBinding.instance.addObserver(AppStarter(clients, store));
    Logs().i(
      '${AppSettings.applicationName.value} started in background-fetch mode. No GUI will be created unless the app is no longer detached.',
    );
    return;
  }

  final clients = await ClientManager.getClients(store: store);

  // Started in foreground mode.
  Logs().i(
    '${AppSettings.applicationName.value} started in foreground mode. Rendering GUI...',
  );
  await startGui(clients, store);
}

/// Fetch the pincode for the applock and start the flutter engine.
Future<void> startGui(List<Client> clients, SharedPreferences store) async {
  // Fetch the pin for the applock if existing for mobile applications.
  String? pin;
  var useBiometrics = false;
  if (PlatformInfos.supportsAppLock) {
    try {
      pin = await const FlutterSecureStorage().read(
        key: 'chat.fluffy.app_lock',
      );
      useBiometrics =
          (await const FlutterSecureStorage().read(
            key: 'chat.fluffy.use_biometrics',
                          )) ==
          'true';
    } catch (e, s) {
      Logs().d('Unable to read PIN from Secure storage', e, s);
    }
  }

  // Preload first client
  final firstClient = clients.firstOrNull;
  await firstClient?.roomsLoading;
  await firstClient?.accountDataLoading;

  // P3：监听 Matrix 登录状态变化，登录成功后将凭证通过 postMessage
  // 发送给父窗口 ImView（桌面端 Electron iframe），完成 IM 账号自动绑定。
  // 仅在 Web 平台生效（kIsWeb），手机/桌面 App 无需此逻辑。
  if (kIsWeb) {
    for (final client in clients) {
      client.onLoginStateChanged.stream.listen((state) {
        if (state == LoginState.loggedIn && client.userID != null && client.accessToken != null) {
          final creds = {
            'type': 'matrix-credentials',
            'homeserverUrl': client.homeserver.toString(),
            'accessToken': client.accessToken,
            'userId': client.userID,
            'deviceId': client.deviceID,
          };
          web.window.parent?.postMessage(
            jsonEncode(creds),
            '*', // 开发环境用 '*'，生产环境由 ImView 校验 origin
          );
        }
      });
    }
  }

  runApp(
    FluffyChatApp(
      clients: clients,
      appLockSettings: (pincode: pin, useBiometrics: useBiometrics),
      store: store,
    ),
  );
}

/// Watches the lifecycle changes to start the application when it
/// is no longer detached.
class AppStarter with WidgetsBindingObserver {
  final List<Client> clients;
  final SharedPreferences store;
  bool guiStarted = false;

  AppStarter(this.clients, this.store);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (guiStarted) return;
    if (state == AppLifecycleState.detached) return;

    Logs().i(
      '${AppSettings.applicationName.value} switches from the detached background-fetch mode to ${state.name} mode. Rendering GUI...',
    );
    // Switching to foreground mode needs to reenable send online sync presence.
    for (final client in clients) {
      client.backgroundSync = true;
      client.syncPresence = PresenceType.online;
    }
    startGui(clients, store);
    // We must make sure that the GUI is only started once.
    guiStarted = true;
  }
}

/// Handles incoming deep links on desktop platforms.
/// Routes to the new-private-chat page which parses the Matrix ID
/// and opens the room / space / DM accordingly.
void _handleDeepLink(Uri? uri) {
  if (uri == null) return;
  if (!uri.toString().startsWith(AppConfig.deepLinkPrefix)) return;
  WidgetsBinding.instance.addPostFrameCallback((_) {
    FluffyChatApp.router.go('/rooms/newprivatechat#${uri}');
  });
}
