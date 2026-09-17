// SPDX-FileCopyrightText: 2019-Present Christian Kußowski
// SPDX-FileCopyrightText: 2019-Present Contributors to FluffyChat
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'dart:io';

import 'package:cronet_http/cronet_http.dart';
import 'package:http/http.dart' as http;

/// On Android this uses [Cronet], which provides HTTP/2, HTTP/3, and better
/// integration with the platform networking stack (e.g. system proxies).
/// Let's Encrypt roots for older Android versions are added via the Android
/// network security config (`network_security_config.xml`).
///
/// [Cronet]: https://developer.android.com/guide/topics/connectivity/cronet
///
/// Cronet 来自 Google Play Services，在无 GMS 的设备（华为/鸿蒙等）或
/// 32 位设备（GMS Cronet 只带 64 位原生库）上创建引擎会抛 Java
/// RuntimeException，此时回退到 dart:io 的 HTTP 实现。
http.Client createPlatformHttpClient() {
  if (!Platform.isAndroid) return http.Client();
  try {
    return CronetClient.fromCronetEngine(
      CronetEngine.build(),
      closeEngine: true,
    );
  } catch (_) {
    return http.Client();
  }
}
