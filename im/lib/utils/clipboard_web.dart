import 'dart:html' as html;

import 'package:flutter/services.dart';

/// Web 实现（browser / Electron 内嵌 iframe）。
///
/// Flutter web（CanvasKit）的 UI 不产生原生 DOM focus：Flutter engine 的
/// navigator.clipboard.writeText 在 iframe 内 document 未聚焦时抛
/// NotAllowedError "Document is not focused"，导致复制静默失败。所以复制前
/// 先聚焦 document。
///
/// dart:html 的 Window 类没暴露 focus()（JS 的 window.focus 存在但 Dart 缺这
/// 个方法），改用 Element.focus()（绑定存在）：聚焦 body 即让 document 进入
/// 聚焦态，效果与 window.focus() 等价。
///
/// focus 后仍失败则兜底：临时 textarea + document.execCommand('copy')
/// （execCommand 已废弃，但对用户手势触发的复制仍普遍生效）。
Future<void> copyToClipboard(String text) async {
  try {
    html.document.body?.focus();
  } catch (_) {
    // ignore
  }
  try {
    await Clipboard.setData(ClipboardData(text: text));
  } catch (_) {
    // 兜底：临时 textarea + execCommand
    try {
      final area = html.TextAreaElement();
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      html.document.body!.append(area);
      area.select();
      html.document.execCommand('copy');
      area.remove();
    } catch (_) {
      // ignore
    }
  }
}

