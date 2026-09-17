/// 统一的剪贴板复制入口（平台分发）。
///
/// Web（Electron 内嵌 iframe）已知问题：Flutter web（CanvasKit）的 UI 不产生
/// 原生 DOM focus，Flutter engine 走 navigator.clipboard.writeText 时若 iframe
/// 内 document 未聚焦，Chromium 抛 NotAllowedError "Document is not focused"，
/// 复制静默失败（移动端/桌面原生走平台通道，无此问题）。
///
/// web 的修复（复制前 focus 自身 iframe）依赖 dart:html / dart:js_util——这两者
/// 是 web-only 库，无法在 Android/Windows 目标编译，所以走 conditional import：
/// 非 web 平台落到 clipboard_stub.dart（纯 Clipboard.setData），web 落到
/// clipboard_web.dart。
export 'clipboard_stub.dart' if (dart.library.html) 'clipboard_web.dart';


