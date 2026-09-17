import 'package:flutter/services.dart';

/// 非 web 平台（Android/iOS/Windows/Linux/macOS 原生）实现：
/// 直接走 Flutter 平台通道，无 focus 问题。
Future<void> copyToClipboard(String text) async {
  await Clipboard.setData(ClipboardData(text: text));
}
