# 商店"新增内容"合并文案（0.0.3 + 0.0.4）

> 用途：Partner Center 商店列表 → 新增内容（What's new，限 1500 字符）。
> 中文版约 430 字符，英文版约 1100 字符，均低于上限。

## 中文（简体）

【v0.0.3 新功能】
· 多语言 Agent：新增德语、法语全套人格模板，完善日语、韩语模板，界面与 Agent 语言扩展至 7 种（中/英/日/韩/繁中/德/法）
· Sherpa 离线语音：新增 Sherpa-ONNX 离线语音合成与多语言语音模型配置，语音输出不再强依赖在线服务
· IM 聊天翻译：聊天翻译统一改走 Jarvis 网关（im_translate），支持多语言互译，无需自行配置翻译服务密钥
· 记忆系统优化：记忆编译、滚动摘要、深度记忆与反思任务更稳更快
· 模型与工具增强：语言感知模型解析、DeepSeek Provider 兼容、web-search / web-reader / install-skill 等工具升级
· 基础设施：内容 OTA、修复机制与启动完整性多语言感知，桥接（上下文 / 微信登录）增强
· 浏览器：支持接入外部（CDP）浏览器，把浏览任务交给更强的外部 Chrome

【v0.0.4 修复】
· 首次安装与冷启动不再出现“满屏英文键”的窗口：语言包在界面渲染前预加载，主窗口等渲染器完全就绪后再显示
· 同版本重装后离线自修复归档不再被误删
· Windows 打包稳定性修复

## English

[v0.0.3 New]
· Multilingual agents: full German & French personas, refined Japanese/Korean templates — UI and agents in 7 languages (zh/en/ja/ko/zh-TW/de/fr)
· Sherpa offline TTS: Sherpa-ONNX voice synthesis with multilingual model configs, less reliance on online services
· IM chat translation now routes through the Jarvis gateway (im_translate) — multilingual translation with zero translation-API setup
· Memory system improvements: faster, more stable compile / rolling-summary / deep-memory / reflection
· Model & tool upgrades: language-aware model resolution, DeepSeek provider compatibility, and upgrades to web-search / web-reader / install-skill and more
· Infrastructure: multilingual-aware OTA, repair and launch integrity; bridge (context / WeChat login) enhancements
· Browser: attach an external (CDP) browser and let a full Chrome handle browsing tasks

[v0.0.4 Fixes]
· No more raw-key screen on first install or cold boot: the locale bundle preloads before the first paint and the main window waits for the renderer
· Offline self-repair archives now survive same-version reinstalls
· Windows packaging reliability fixes
