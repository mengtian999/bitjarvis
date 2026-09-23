<p align="center">
  <a href="https://www.bitjarvis.chat">官网</a>
</p>

<h1 align="center">Bit Jarvis</h1>

<p align="center"><strong>同一个贾维斯，不同的 Agent</strong></p>

<p align="center">替你干活，也替你把人连起来。剩下的时间，还给你。</p>

<p align="center">
  一个有多端、有记忆、有性格的 AI 助理 —— 桌面端仓库 · <a href="README_EN.md">English</a>
</p>

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/mengtian999/Bitjarvis/releases)

> **本仓库为桌面端代码。** 移动端在独立仓库托管，本仓库不包含移动端。

<p align="center">
  <img src="https://www.bitjarvis.chat/jgt.png" alt="Bit Jarvis" width="800">
</p>

---

## Bit Jarvis 是什么

Bit Jarvis 是一个个人 AI 助理（桌面 Agent）：有记忆，有性格，会主动行动，还能让多个 Agent 在你的电脑上一同工作。

作为助手，Ta 是温柔的：不需要写复杂的配置，不需要理解晦涩的术语，它不是只面向开发者，而是为每一个坐在电脑前工作的人设计的。
作为工具，Ta 是强大的：记住你说过的每一件事，操作你的电脑、浏览网页、搜索信息、读写文件、执行代码、管理日程，还能自主学习新技能。

如果你用过 Claude Code、Codex、Manus 等 CLI 或图形化的 Agent，你会在 Bit Jarvis 里找到熟悉又新奇的感觉——但它更进一步：拥有完备的图形界面、记忆与人格、书桌，还能通过内嵌 IM 与任何一端对话、跨端接力。

## 功能特性

**记忆** — 结合主流记忆方案自研的记忆系统，近期的事情记得非常牢固，也让旧记忆自然淡出。

**人格** — 不是千篇一律的「AI 助手」。通过人格模板和自定义人格文件塑造独特性格，每个 Agent 都有自己的说话方式和行为逻辑。Agent 之间的分离做得很好：一个 Agent 就是一个文件夹，方便备份。

**工具** — 读写文件、执行一次性命令或持续终端会话、浏览网页、通过浏览器后端或 API 搜索互联网、截图、分段长截图、媒体预览、检查网页……覆盖日常办公的绝大多数场景。也可以通过 server-first CLI 连接同一个 Jarvis Server，在终端里查看状态、列会话、继续对话。

**SKILLS 支持** — 内置兼容庞大的社区 SKILLS 生态。干活之前，Agent 有时会从 GitHub 安装社区技能，也可以自己编写并学会新技能。默认启用严格的 SKILLS 审核，如果发现装不上可以自行关闭。

**角色卡与技能包** — Agent 可以导入 / 导出为本地优先的角色卡 zip，按白名单携带人格、头像、可选记忆和 Skills。Skill Bundle 是独立的技能包基础设施，可以分组、拖拽、成组启用，并单独导出为 zip 方便迁移和分享。

**多 Agent** — 创建多个 Agent，各自有独立记忆、人格和定时任务。Agent 之间可以频道群聊协作，也可以互相委派任务。

**书桌** — 每个 Agent 都有自己的书桌，可以放文件、写笺（类似便签，Agent 会主动读取并执行）。支持拖拽、文件预览和工作区文件树变更监听，是你和 Agent 之间的异步协作空间。

**全屏媒体查看器** — 聊天或书桌上的任意图片、SVG、视频，点开即有暗色遮罩全屏预览：滚轮缩放、拖拽平移、`+` / `−` / `0` 快捷键，左右箭头可在同会话 / 同目录的相邻媒体间切换。

**会话管理** — 侧栏聊天记录搜索（标题命中优先，必要时检索正文）；旧会话可归档、从设置恢复或永久删除；聊天正文选中文本自动进入输入框引用卡片，追问时保留原文语境。

**定时任务与心跳** — 支持 Cron 定时任务，也会定期巡检书桌上的文件变化。自动化执行器把「什么时候触发」和「做什么」拆开：复杂任务仍由 Agent 后台执行，轻量提醒可以直接发通知，插件动作也能被计划调用。

## 内嵌 IM 与跨端接力

**内嵌 IM** — 桌面端侧栏提供「IM」入口，通过 `desktop/src/react/components/ImView.tsx` 在应用内以 iframe 内嵌 Jarvis IM：

- 地址：`http://127.0.0.1:{port}/im/`
- 由 server 的 `/im/` 静态路由托管（`im/build/web`，Flutter Web 产物）
- 打包时经 `extraResources` 随应用分发到 `im-web/`
- iframe 与桌面端主题实时同步（亮 / 暗色跟随）

**互通架构** — 用户只需 **1 个 Jarvis IM 账号**，每台设备上的每个 Agent 都是一个 **AppService 虚拟用户**（如 `@jarvis_home3f2a`）：

- 每条 Agent 终端以 1 条 Poll 模式 `/sync` 长轮询接收消息，NAT 后也能用；
- 消息路由完全复用现有 Bridge 体系：`m.room.message` → BridgeManager `_handleMessage` → owner 鉴权 → AgentExecutor 执行；
- homeserver 为自建 `bitjarvis.chat`。

**跨端接力** — 手机 / 任何一端都可以在 IM 里和桌面 Agent 直接对话，指令照收、回复照回；出门时在手机上对桌面 Agent 发 `/rc` 即可接管桌面，写到一半的报告、查到一半的数据原封不动接着做。移动端客户端在独立仓库，本仓库仅桌面端。

**多平台接入** — 同一个 Agent 也可以同时接入 Telegram、飞书、钉钉、QQ、微信，在任何平台和 Ta 对话，甚至远程操作电脑；Bridge 消息带平台上下文，通知也可以回发到当前外部平台。

## 安全

| 层面 | 说明 |
|------|------|
| 双层沙盒 | 应用层 PathGuard 四级访问控制 + 操作系统级沙盒（macOS Seatbelt / Linux Bubblewrap / Windows restricted token） |
| 本地优先 | 数据存在你的本机，默认纯本地运行、不依赖云 |
| 敏感操作确认 | 写文件、执行命令、网络请求，每一步都要你点头 |
| 完全开源 | Apache 2.0，代码可审计，社区可监督 |

## 架构

```
desktop/     Electron 应用 + React 前端
server/      Hono HTTP + WebSocket 服务（独立 Node.js 进程）
core/        引擎编排层 + Manager
lib/         核心库（记忆、工具、沙盒、Bridge、插件等）
hub/         调度器、频道路由、事件总线
shared/      跨层共享工具（config schema、模型引用等）
plugins/     内置系统插件（随应用打包）
skills2set/  内置技能定义
packages/    npm workspaces（plugin-sdk 等）
im/          Jarvis IM 源码（内嵌模块）
cli/ scripts/ tools/ tests/   命令行入口 / 构建打包签名工具 / Vitest 测试
```

引擎层协调多个 Manager（Agent、Session、Model、Preferences、Skill、Channel、BridgeSession、Plugin 等），通过统一的 facade 暴露；Hub 负责后台任务（心跳巡检、自动化 / 定时任务、频道路由、Agent 间通信），独立于当前聊天会话运行。Server 是独立 Node.js 进程（由 Electron spawn 或独立启动），Vite 打包 + @vercel/nft 追踪依赖，与渲染进程通过 WebSocket 通信。用户数据由 `JARVIS_HOME` 决定（生产默认 `~/.jarvis`，开发默认 `~/.jarvis-dev`）。

## 技术栈

| 层 | 技术 |
|------|------|
| 桌面端 | Electron 42 |
| 前端 | React 19 + Zustand 5 + CSS Modules |
| 构建 | Vite 7 |
| 服务端 | Hono + @hono/node-server |
| Agent 运行时 | Pi SDK（@earendil-works/pi-coding-agent） |
| 数据库 | better-sqlite3（WAL 模式） |
| 测试 | Vitest |
| 国际化 | 5 语言（zh / en / ja / ko / zh-TW） |

## 平台支持

| 平台 | 状态 |
|------|------|
| macOS（Apple Silicon / Intel） | ✅ 已支持（已签名公证） |
| Windows | 🚧 Beta（安装包暂未代码签名，SmartScreen 提示属正常现象） |
| Linux | ✅ 已支持（AppImage / deb） |

## 快速开始

从 [GitHub Releases](https://github.com/mengtian999/Bitjarvis/releases) 下载对应平台安装包：macOS `.dmg`、Windows `.exe`、Linux `.AppImage` / `.deb`。

首次启动的引导向导会带你完成配置：选择语言、输入你的名字、连接模型提供商（API key + base URL），并选择三个模型——**对话模型**（主对话）、**小工具模型**（轻量任务）、**大工具模型**（记忆编译和深度分析）；设置页还可单独选择**视觉模型**。支持 OpenAI 兼容、Anthropic 风格、OAuth Provider 和 Ollama 本地模型等多类接入。

## 开发

> 需要 Node.js `>=24.12 <25`。

```bash
npm install            # 安装依赖
npm start              # 构建 renderer 后用 Electron 启动
npm run dev:renderer   # Vite HMR（配合下一行使用）
npm run start:vite     # Electron 开发模式启动
npm run server         # 仅启动 server
npm run cli            # server-first CLI
npm run typecheck && npm run lint && npm test   # 检查与测试
npm run dist           # 打包 macOS（dmg）
npm run dist:win       # 打包 Windows（nsis）
npm run dist:linux     # 打包 Linux（AppImage / deb）
```

## 相关链接

- 官网：<https://bitjarvis.chat>
- 移动端：<https://github.com/mengtian999/jarvis>（独立仓库，本仓库不包含）
- [提交 Issue](https://github.com/mengtian999/Bitjarvis/issues) · [安全政策](SECURITY.md) · [插件开发指南](PLUGINS.md) · [贡献指南](CONTRIBUTING.md)

## 致谢

- [OpenHanako](https://github.com/liliMozi/openhanako)：桌面端的上游项目。
- [tw93/kami](https://github.com/tw93/kami)：beautify 插件 HTML 美学规范的「路由器 + 平级章节按需获取」渐进披露结构受其启发。

## 许可证

[Apache License 2.0](LICENSE)
