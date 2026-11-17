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
import 'utils/agent_bridge.dart';
import 'utils/background_push.dart';
import 'widgets/fluffy_chat_app.dart';
import 'widgets/share_scaffold_dialog.dart';

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

  // [T-im-deeplink] Embedded (Agent host) deep link handling:
  // When running as a Flutter module inside the native Agent app, the host
  // forwards IM deep-link URLs (from Android intent-filters or
  // ShareReceiverActivity) via MethodChannel. Subscribe early so links
  // arriving before runApp() are not lost; route on post-frame callback.
  if (!kIsWeb && await AgentBridge.isEmbedded()) {
    AgentBridge.startDeepLinkReceiver();
    AgentBridge.onDeepLink.listen((uri) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        FluffyChatApp.router.go('/rooms/newprivatechat#$uri');
      });
    });
    AgentBridge.onShare.listen((content) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final nav = FluffyChatApp.router.routerDelegate.navigatorKey.currentState;
        while (nav?.canPop() == true) {
          nav?.pop();
        }
        FluffyChatApp.router.go(
          '/rooms',
          extra: [TextShareItem(content)],
        );
      });
    });
  }

  // kIsWeb deep link handling (BitJarvis desktop Electron host):
  // The desktop main process forwards jarvis://im/{mxid} via postMessage.
  if (kIsWeb) {
    web.window.addEventListener('message', (web.Event e) {
      final m = e as web.MessageEvent;
      // 桌面端宿主（Electron 主窗口）是 file:// 页面，postMessage 的
      // origin 是 opaque 的 "null"，不能按同源过滤——否则父窗口的
      // im/open、im/forward 消息会被丢弃（内嵌模式下 IM 一直空白/无响应）。
      final origin = m.origin;
      if (origin != web.window.location.origin &&
          origin != 'null' &&
          origin != 'file://') {
        return;
      }
      // m.data is a JS object on web; JsObject is not exported by universal_html,
      // so use dynamic property access (kIsWeb-only block, never runs on VM).
      final d = (m.data as dynamic)['type'];
      if (d == 'im/open') {
        final mxid = (m.data as dynamic)['mxid'] as String;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          FluffyChatApp.router.go('/rooms/newprivatechat#$mxid');
        });
      }
      if (d == 'im/forward') {
        // 桌面端 Agent 对话一键转发：文本作为草稿预填，由用户选好友/群
        // 并编辑后手动发送（房间选择器复用 '/rooms' 的 share-items 通道）。
        final text = ((m.data as dynamic)['text'] as String?) ?? '';
        if (text.isNotEmpty) {
          // ack 让父窗口知道本次转发已被接收（ImView 据此清掉待转发文本）。
          // 载荷必须是 JSON 字符串：Dart Map 经结构化克隆可能抛
          // DataCloneError（与既有 matrix-credentials 消息同一模式）。
          web.window.parent?.postMessage(
            jsonEncode({'type': 'im/forward-ack'}),
            '*',
          );
          WidgetsBinding.instance.addPostFrameCallback((_) {
            FluffyChatApp.router.go(
              '/rooms',
              extra: [DraftShareItem(text)],
            );
          });
        }
      }
    }, true);
    // 监听器注册完成即上报就绪：父窗口（ImView）若有因早发而未送达的
    // im/forward 草稿，会在此刻重发，避免时序竞争丢失转发内容。
    // 注意必须放在回调外——只在启动时发一次，而不是每收到一条消息都发。
    // 载荷用 JSON 字符串（Dart Map 经结构化克隆可能抛 DataCloneError）。
    web.window.parent?.postMessage(jsonEncode({'type': 'im/ready'}), '*');
  }

  final store = await AppSettings.init();
  Logs().i('Welcome to ${AppSettings.applicationName.value} <3');

  kEnableMatrixSdkBenchmarks = AppSettings.benchmarksInLogs.value;

  if (!_vodozemacInitialized) {
    await vod.init(wasmPath: './assets/assets/vodozemac/');
    _vodozemacInitialized = true;
  }

  Logs().nativeColors = !PlatformInfos.isIOS;

  // [T-im-merge] Background-fetch branch removed for the Agent host.
  // Cached-engine mode runs main() while the engine is still detached from
  // any Activity; the original branch returned before runApp() and the IM
  // screen never rendered. The host drives the lifecycle itself, so the
  // background-push setup isn't needed here. Standalone IM APK behaviour is
  // restored separately if/when that build target is revived.
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
