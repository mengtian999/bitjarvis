<p align="center">
  <a href="https://www.bitjarvis.chat">Official Site</a>
</p>

<h1 align="center">Bit Jarvis</h1>

<p align="center"><strong>One Jarvis, different agents</strong></p>

<p align="center">It gets things done for you, and it keeps everyone connected. The rest of your time — it gives back to you.</p>

<p align="center">
  A personal AI assistant with memory and soul — desktop repository · <a href="README.md">中文</a>
</p>

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/mengtian999/Bitjarvis/releases)

> **This repository contains the desktop code.** The mobile client and the IM client live in separate repositories and are not part of this repo.

<p align="center">
  <img src="https://www.bitjarvis.chat/jgt.png" alt="Bit Jarvis" width="800">
</p>

---

## What is Bit Jarvis

Bit Jarvis is a personal AI assistant (a desktop agent): it has memory, it has personality, it acts on its own, and it can run multiple agents working together on your machine.

As an assistant, it is gentle: no complex configuration files, no obscure jargon. It is designed not just for developers, but for everyone who sits at a computer.
As a tool, it is powerful: it remembers everything you say, operates your computer, browses the web, searches for information, reads and writes files, executes code, manages your schedule, and can even learn new skills on its own.

If you have used CLI or GUI agents like Claude Code, Codex, or Manus, you will find familiar yet novel feelings in Bit Jarvis — but it goes further: a complete GUI, memory and personality, a desk, and the ability to chat from anywhere and hand off work across devices through its embedded IM.

## Features

**Memory** — A custom memory system built on mainstream memory schemes. Recent events stay sharp while older ones fade naturally.

**Personality** — Not a generic "AI assistant". Personality templates and custom personality files give each agent its own voice and behavior. Agents are cleanly separated — one agent is one folder, easy to back up.

**Tools** — Read/write files, run one-shot commands or persistent terminal sessions, browse the web, search the internet through browser-backed or API-backed providers, take screenshots and segmented long screenshots, preview media, inspect pages... covering the vast majority of daily office scenarios. A server-first CLI can also attach to the same Jarvis Server to show status, list sessions, and continue chats from a terminal.

**Skills** — Built-in compatibility with the large community Skills ecosystem. Agents can install community skills from GitHub on the fly, or write and master new skills themselves. A strict skills review is enabled by default — you can turn it off if something refuses to install.

**Character Cards & Skill Bundles** — Agents can be imported / exported as local-first character-card zip packages that carry allowlisted identity, avatar, optional memory, and Skills. Skill Bundles are a standalone skill-pack infrastructure: group skills, drag them between bundles, toggle whole bundles, and export a bundle as a zip for migration and sharing.

**Multi-Agent** — Create multiple agents, each with independent memory, personality, and scheduled tasks. Agents can collaborate in channel group chats or delegate tasks to each other.

**Desk** — Every agent has its own desk for files and notes (like sticky notes that agents proactively read and act on). Drag-and-drop, file preview, and workspace file-tree change watching turn the desk into an async collaboration space between you and your agent.

**Full-Screen Media Viewer** — Click any image, SVG, or video in chat or on the desk to open a dark-overlay full-screen preview: wheel-zoom, drag-to-pan, `+` / `−` / `0` shortcuts, and left/right arrow keys to switch between adjacent media in the same session or folder.

**Session Management** — Search chat history in the sidebar (title matches first, falling back to message body). Old sessions can be archived, restored from settings, or permanently deleted. Selecting text in a chat message turns it into a composer quote card, keeping the original context for follow-ups.

**Cron & Heartbeat** — Scheduled tasks via Cron, plus periodic checks for changed files on the desk. The automation executor separates "when to run" from "what to do": complex tasks still run as background agent sessions, lightweight reminders can fire as notifications, and plugin actions can be scheduled too.

## Embedded IM & Cross-Device Handoff

**Embedded IM** — The desktop sidebar provides an "IM" entry that embeds Jarvis IM in-app as an iframe via `desktop/src/react/components/ImView.tsx`:

- URL: `http://127.0.0.1:{port}/im/`
- Served by the server's `/im/` static route (`im/build/web`, Flutter web build)
- Distributed with the packaged app through `extraResources` as `im-web/`
- The iframe follows the desktop theme in real time (light / dark)

**Interop architecture** — You only need **1 Jarvis IM account**; every agent on every device is an **AppService virtual user** (e.g. `@jarvis_home3f2a`):

- Each agent terminal uses a single Poll-mode `/sync` long poll to receive messages, which works behind NAT;
- Message routing fully reuses the existing Bridge pipeline: `m.room.message` → BridgeManager `_handleMessage` → owner authorization → AgentExecutor;
- The homeserver is self-hosted at `bitjarvis.chat`.

**Cross-device handoff** — Any endpoint can chat with a desktop agent directly through IM: commands are received, replies are delivered. Out of the door? Send `/rc` to a desktop agent from your phone to take over the machine — the half-written report and half-queried data continue exactly where you left off. The mobile client lives in a separate repository; this repo is desktop-only.

**Multi-Platform Bridge** — The same agent can also join Telegram, Feishu, DingTalk, QQ, and WeChat at once, so you can talk to it from any platform or even remotely operate your computer. Bridge messages carry platform context, and notifications can be posted back to the current external platform.

## Security

| Layer | Description |
|-------|-------------|
| Double-layer sandbox | App-level PathGuard with 4-tier access control + OS-level sandbox (macOS Seatbelt / Linux Bubblewrap / Windows restricted token) |
| Local-first | Data stays on your machine; runs fully offline by default, no cloud dependency |
| Sensitive-op confirmation | Writing files, running commands, and network requests all need your approval |
| Fully open source | Apache 2.0 — auditable code, community oversight |

## Architecture

```
desktop/     Electron app + React frontend
server/      Hono HTTP + WebSocket service (standalone Node.js process)
core/        Engine orchestration + Managers
lib/         Core libraries (memory, tools, sandbox, bridge, plugins, etc.)
hub/         Scheduler, channel routing, event bus
shared/      Cross-layer shared utilities (config schema, model refs, etc.)
plugins/     Built-in system plugins (bundled with the app)
skills2set/  Built-in skill definitions
packages/    npm workspaces (plugin-sdk, etc.)
im/          Jarvis IM source (embedded module)
cli/ scripts/ tools/ tests/   CLI entry / build & signing tools / Vitest tests
```

The engine layer coordinates multiple managers (Agent, Session, Model, Preferences, Skill, Channel, BridgeSession, Plugin, etc.) and exposes them through a unified facade. The Hub handles background work (heartbeat, automation / cron, channel routing, inter-agent messaging) independent of the active chat session. The Server runs as a standalone Node.js process (spawned by Electron or started on its own), bundled with Vite and dependency-traced via @vercel/nft, and talks to the renderer over WebSocket. User data is rooted at `JARVIS_HOME` (`~/.jarvis` in production, `~/.jarvis-dev` in development).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 42 |
| Frontend | React 19 + Zustand 5 + CSS Modules |
| Build | Vite 7 |
| Server | Hono + @hono/node-server |
| Agent runtime | Pi SDK (@earendil-works/pi-coding-agent) |
| Database | better-sqlite3 (WAL mode) |
| Testing | Vitest |
| i18n | 5 languages (zh / en / ja / ko / zh-TW) |

## Platform Support

| Platform | Status |
|----------|--------|
| macOS (Apple Silicon / Intel) | ✅ Supported (signed & notarized) |
| Windows | 🚧 Beta (installer not code-signed yet; SmartScreen prompts are expected) |
| Linux | ✅ Supported (AppImage / deb) |

## Quick Start

Download the installer for your platform from [GitHub Releases](https://github.com/mengtian999/Bitjarvis/releases): macOS `.dmg`, Windows `.exe`, Linux `.AppImage` / `.deb`.

On first launch, a setup wizard walks you through configuration: pick a language, enter your name, connect a model provider (API key + base URL), and choose three models — **chat model** (main conversation), **small tool model** (lightweight tasks), and **large tool model** (memory compilation & deep analysis). A **vision model** can be set separately in settings. OpenAI-compatible, Anthropic-style, OAuth providers, and local Ollama models are all supported.

## Development

> Requires Node.js `>=24.12 <25`.

```bash
npm install            # Install dependencies
npm start              # Build the renderer and launch Electron
npm run dev:renderer   # Vite HMR (use together with the next line)
npm run start:vite     # Start Electron in development mode
npm run server         # Server only
npm run cli            # Server-first CLI
npm run typecheck && npm run lint && npm test   # Checks & tests
npm run dist           # Package macOS (dmg)
npm run dist:win       # Package Windows (nsis)
npm run dist:linux     # Package Linux (AppImage / deb)
```

## Links

- Official site: <https://bitjarvis.chat>
- Mobile: <https://github.com/mengtian999/jarvis> (separate repository, not included here)
- [Report an Issue](https://github.com/mengtian999/Bitjarvis/issues) · [Security Policy](SECURITY.md) · [Plugin Development](PLUGINS.md) · [Contributing](CONTRIBUTING.md)

## Acknowledgments

- [OpenHanako](https://github.com/liliMozi/openhanako): the upstream project of the desktop.
- [tw93/kami](https://github.com/tw93/kami): the progressive-disclosure structure of the beautify plugin's HTML aesthetic guide (a router entry with flat on-demand sections) was inspired by this project.

## License

[Apache License 2.0](LICENSE)
