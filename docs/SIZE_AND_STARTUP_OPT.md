# 安装包体积与启动性能优化方案

> 状态：P0+P1 已落地（A1/A5.1/A2/A3/A4 + boot-summary），P2 已落地（B1/A5.2），P3 部分落地（B3-lite/A6-lite，B4 否决，B2 人工评审项）｜ 版本：v1.2 ｜ 最后更新：2026-11-05
>
> 基线版本：v0.0.2（Windows x64 NSIS）。本文回答两件事：**安装包为什么这么大、怎么减**；**启动为什么慢、怎么快**。所有数字均为本仓库当前工作区实测（`dist/win-unpacked`、`dist-server/win-x64`），文件索引见 §11。

## 目录

| 章节 | 内容 |
|---|---|
| §1 | 背景与目标 |
| §2 | 现状基线（量化数据） |
| §3 | 根因分析（体积 R1-R3、启动 S1-S4） |
| §4 | 方案总览与优先级矩阵 |
| §5 | A 组：启动性能优化（A1-A6） |
| §6 | B 组：安装包体积优化（B1-B6） |
| §7 | 分阶段实施计划 P0-P3 |
| §8 | 测试方案 |
| §9 | 验收标准（DoD） |
| §10 | 风险与回滚 |
| §11 | 附录（文件索引、基线明细） |

---

## §1 背景与目标

### 1.1 背景

用户反馈两个问题：

1. **安装包体积大**（v0.0.2 Windows x64 为 697 MB），最占空间的是 TTS/ASR。
2. **安装后启动慢**（尤其首次启动与装了 Defender 的机器）。

### 1.2 目标

| 维度 | 现状 | 目标 |
|---|---|---|
| 安装包体积（win NSIS） | 697 MB | **≤ 500 MB**（B1 后），争取 ≤ 480 MB |
| 安装后磁盘占用 | ~1.45 GB（安装 1.2 GB + 首启解压 232 MB） | ≤ 1.1 GB |
| 日常冷启动（SSD、Defender 开，二次启动） | splash 到主窗口可用可达 60s+（#719/#736 机器） | **≤ 15s**，典型机器 ≤ 8s |
| 首次启动 "preparing" 阶段 | 串行解压 232 MB + sha256 | 缩短 ≥ 40% |
| 语音功能 | 不降级：本地 ASR/TTS 仍可用，只是改为按需获取 | 体验不变，首次启用多一步下载 |

### 1.3 非目标

- 不改变 seed/artifact 双包架构（OTA 与 3-strikes 回退依赖它，重构是另一个量级的方案）。
- 不引入在线 ASR/TTS 作为唯一方案（离线语音是产品卖点）。
- 不做 Electron 换壳、不做 Tauri 迁移。

---

## §2 现状基线（量化数据）

### 2.1 安装包 → 磁盘构成（实测 2026-11-05）

```
Bit Jarvis-0.0.2-Windows-x64.exe        697 MB  (NSIS, compression: maximum)
dist/win-unpacked                       1.2 GB
├─ resources/sherpa-onnx                390 MB   ← 用户感知的"TTS和ASR"
│   ├─ models/asr/sense-voice           229 MB   （model.int8.onnx 单文件 229M）
│   ├─ models/tts/zh                    116 MB   （vits-zh-hf-fanchen-C.onnx）
│   ├─ bin + lib                         ~45 MB   （onnxruntime.dll 17M ×2、offline/offline-tts exe 等）
│   └─ models/vad                        0.6 MB
│   （kokoro-multi 408M / tts ko 78M 已被 extraResources filter 排除，不在包内）
├─ resources/seed                       232 MB   （server tar.gz 158M + renderer tar.gz 74M）
│   └─ 首启后 JARVIS_HOME/artifacts 再解压一份 → 实际占盘双份
├─ resources/git (MinGit)                91 MB
├─ resources/im-web (Flutter web)        61 MB   （canvaskit 42M + main.dart.js 11M）
├─ resources/app.asar + assets           73 MB
└─ Electron 本体                        ~304 MB   （locales 已裁剪）
```

### 2.2 server artifact 内部（Defender 扫描面）

```
dist-server/win-x64                     411 MB
├─ node_modules（external deps ~50 包）  21,514 个文件  ← 冷启动 Defender 逐文件扫描
├─ bundle/index.js                      ~750 KB 单文件入口
└─ jarvis-server.exe                    = Node v26.8.2 裸运行时（改名）
```

### 2.3 启动时间线（打包首启）

```
T0 electron → bootstrap.cjs（CA / JARVIS_HOME / launch.log）
T2 app.whenReady → splash 显示（最短展示 3s）
T3 startServer:
     首次: 验签 + 解压 server 158M + renderer 74M + sha256   ← 首启大头
     spawn jarvis-server.exe（jarvis-win-sandbox 守护）
T4 server:
     冷 import bundle/index.js                              ← 日常大头（#719/#736，Defender 下 60s+）
     → engine.init() 全串行：迁移 → sqlite 开库 → initAllAgents
       → skills/plugins 扫描 → watcher 建立                  ← 都在就绪点之前
     → 写 JARVIS_HOME/server-info.json                       ← 就绪点
T5 桌面轮询(200ms)到 server-info → 才创建主窗口
T6 renderer app-ready → 关 splash
```

关键事实：

- **TTS/ASR 模型零启动加载**：每次合成/识别 spawn 一次 sherpa CLI 子进程（`core/tts/adapters.ts:391`、`core/speech-recognition/adapters.ts:199`），启动完全不碰模型。启动慢与语音无关。
- 就绪点被 `engine.init()` 全量串行拖后（`core/engine.ts:2423-2759`），其中 skills 扫描、chokidar watcher、channel repair、模型同步并非首屏必需。
- MinGit、sherpa、memory compile、gateway sync 均已 defer/background，不是启动瓶颈。

---

## §3 根因分析

### 体积根因

| 编号 | 根因 | 量化 |
|---|---|---|
| R1 | SenseVoice int8 单模型 229 MB + zh TTS 116 MB 全量内置，即使用户从不使用本地语音 | -345 MB 原始 / 约 -230 MB 安装包 |
| R2 | MinGit 91 MB 无条件内置（启动不需要 git，仅 agent 工具 shell 用） | -91 MB 原始 |
| R3 | im-web 的 canvaskit 42 MB 随包分发（可 CDN 化/按需） | -42 MB 原始 |
| R4（磁盘） | seed tar.gz 在 `resources/seed` 与 `JARVIS_HOME/artifacts` 双份存放 | -232 MB 磁盘 |

### 启动根因

| 编号 | 根因 | 量化 |
|---|---|---|
| S1 | Defender 实时扫描 21,514 个 external node_modules 文件，冷 import 每次都要重新过一遍（无 compile cache，V8 每次重新 parse） | #719/#736 实测 60s+ |
| S2 | `engine.init()` 串行做完所有事才写 server-info.json | 数秒（机器差则 10s+） |
| S3 | 主窗口在 server 就绪后才创建，renderer 加载与 server 启动完全串行 | 1-5s 白等 |
| S4 | 首启两个 seed 归档串行解压+验签，全部完成后才 spawn server | 数秒~十几秒（HDD 更差） |

---

## §4 方案总览与优先级矩阵

| 项 | 内容 | 收益 | 工作量 | 风险 | 阶段 |
|---|---|---|---|---|---|
| **A1** | server 开启 V8 compile cache | 日常启动 -30~60%（import 段） | 极小（~10 行） | 低 | **P0** |
| **A2** | external 依赖内联，减少 Defender 扫描面 | 日常启动大头（21.5k 文件 → <3k） | 中 | 中 | **P1** |
| **A3** | server-info 提前就绪 + 非关键 init 后台化 | 日常启动 -2~8s | 中 | 中 | **P1** |
| **A4** | 主窗口与 server 并行启动 | 首屏 -1~5s | 小 | 低 | **P1** |
| **A5** | 首启解压并行化 + tar.gz 用后清理 | 首启 -30%+，磁盘 -232 MB | 小 | 中 | **P0/P2** |
| **A6** | Defender 排除引导（可选） | 重症机器 | 小 | 低 | P3 |
| **B1** | **ASR/TTS 模型按需下载** | 安装包 -200 MB+ | 中大 | 中 | **P2（体积主力）** |
| **B2** | 更小的 TTS/ASR 模型（若坚持内置） | TTS -53 MB / ASR 评估后定 | 小 | 低 | P3 |
| **B3** | MinGit 按需化 | 安装包 -60~70 MB | 中 | 中 | P3 |
| **B4** | im-web canvaskit 外置 | 安装包 -30~40 MB | 小 | 低 | P3 |
| **B5** | app.asar/assets 审计 | 数 MB | 小 | 低 | P3 |

依赖关系：B1 与 B2 二选一或叠加；A5 的"删 tar.gz"依赖 B1 之外不变更 seed 布局；A2/A3/A4 相互独立可并行。

---

## §5 A 组：启动性能优化

### A1. server 开启 V8 compile cache（P0，快赢）

**现状**：`server/bootstrap.ts` 直接 `await import(serverEntry)`，V8 每次冷启动都要重新 parse 整个 bundle + external 依赖。Node ≥ 22.8 提供 `module.enableCompileCache()`，把 parse 产物缓存到磁盘，二次启动直接 mmap。

**改动**（`server/bootstrap.ts`，在 import entry 之前）：

```ts
import { enableCompileCache } from "node:module";
// JARVIS_HOME 已在 server 侧由 main.cjs 注入；standalone CLI 场景回退到临时目录
try {
  const cacheDir = process.env.JARVIS_HOME
    ? path.join(process.env.JARVIS_HOME, "cache", "v8-compile")
    : undefined;
  enableCompileCache(cacheDir);
} catch { /* 缓存不可用不影响启动 */ }
```

**要点**：
- 必须在 `await import()` 之前调用；缓存损坏时 Node 自动忽略重建，无需自愈逻辑。
- 缓存目录放 `JARVIS_HOME/cache/v8-compile`，随 JARVIS_HOME 清理策略走；预期占用 20~50 MB。
- 首次启动无收益（正常），二次起收益。uninstall 清理 JARVIS_HOME 时自然清除。

**预期**：bundle + 依赖的 parse 段 -30~60%；对 Defender 扫描无帮助（那是 A2 的事）。

### A2. external 依赖内联，缩减 Defender 扫描面（P1，启动主力）

**现状**：`scripts/build-server.mjs` 策略为 "Vite bundle + ~50 个 external 走 npm install"，导致 node_modules 有 **21,514 个文件**。Defender 实时保护对每个首次触达文件做扫描，这是 #719/#736 上 60s+ 冷 import 的主因。文件数不降，任何 JS 层优化都绕不过。

**改动**（`scripts/build-server-phases.mjs` 的 external 派生逻辑 + `vite.config.server.js`）：

1. 列出当前 external 清单（dist-server 产物的 package.json dependencies），逐个分类：
   - **native addon**（better-sqlite3、@node-rs/jieba、vodozemac 等）→ 保持 external（ABI 必须）；
   - **纯 JS 可打包**（绝大多数 SDK）→ 改为 inline 进 bundle；
   - **动态 require / worker 文件路径依赖** → 外置但合并为单文件拷贝（排除 .map/.md/ts 源码）。
2. `pruneServerNodeModulesViaNft` 之后追加一道 **冗余文件剔除**：`*.map`、`*.d.ts`、`README*`、`CHANGELOG*`、`*.ts` 源码、tests 目录（保守白名单方式，避免破坏动态引用）。
3. 验收指标：node_modules 文件数 **< 3,000**（目标 < 1,500），包体积同步下降。

**验证方法**：同一台机器开/关 Defender 实时保护各测 3 次冷启动取中位数；对照 `dist-server` 文件数。

**风险**：inline 打包可能破坏个别 SDK 的运行时文件查找（如 worker 脚本、wasm 路径）。逐包内联、逐包 smoke（server 已有 `verify:standalone:server --smoke`，扩充覆盖到受影响 SDK 的路由）。

### A3. server-info 提前就绪 + 非关键 init 后台化（P1）

**现状**：`server/index.ts:1231-1252` 在 `engine.init()` 全部完成后才写 `server-info.json`。而 init 里的 skills/plugins 扫描、watcher 建立、channel repair、模型同步对"首屏可交互"并非必需；HTTP 端口早已 early-bind 且未就绪路由统一返回 503 `server_starting`（`server/index.ts:388-405`），**就绪语义的基础设施已经存在**。

**改动**（`core/engine.ts` 的 `init()` 拆分 + `server/index.ts`）：

1. 把 `engine.init()` 显式拆成两段：
   - **critical**（阻塞就绪）：迁移、sqlite 开库、credential 修复、必需 agent 初始化、路由所需的最小 service 集；
   - **background**（就绪后 `void` 执行）：`skills.watch()` chokidar、`refreshFileHistoryWorkspaces()`、channel cursor repair、`syncModelsAndRefresh()`（已是后台的 gateway sync 保持）、memory ticker 启动、非活跃插件的动态 import。
2. critical 完成即写 `server-info.json`（语义：端口已绑、核心路由可用），background 排入现有后台队列。
3. **契约保障**：background 未完成期间，依赖 skills 列表/插件能力的路由继续走 503 或返回 `starting` 状态（扩展现有 `serverRuntimeState`，加 `backgroundReady` 布尔），renderer 已有启动等待 UI。

**开关**：`JARVIS_EARLY_READY=0` 环境变量回退旧行为（灰度/排障用）。

**预期**：就绪点前移 2~8s（取决于 skills/agents 数量）。

### A4. 主窗口与 server 并行启动（P1）

**现状**：T5 才 `createMainWindow`，renderer 的 HTML/JS 解析、字体加载与 server 的 engine.init 完全串行。

**改动**（`desktop/main.cjs` `app.whenReady` 编排）：

1. 在 `startServer()` 完成 spawn（非就绪）之后、`pollServerInfo` 期间即创建主窗口并加载 renderer；
2. renderer 对核心 API 的初始请求遇到 503 `server_starting` 时进入已有的等待/重试态（确认 `server_starting` 错误码在 renderer 侧有兜底 UI，无则补一个骨架屏）；
3. splash 关闭时机不变（仍等 `app-ready` IPC），只是主窗口的加载时间被 overlap 掉。

**预期**：首屏可用时间 -1~5s；低端机注意 GPU 进程与 server init 抢 CPU，实测后若负收益可只在 SSD/内存达标机器启用（读 `user/gpu-startup.json` 既有历史）。

### A5. 首启解压优化（P0 做并行化，P2 做清理）

**现状**：`resolvePackagedArtifactBoot`（`desktop/main.cjs:1420-1508`）串行解压 server 158M + renderer 74M 并做 sha256，全程在 spawn server 之前。

**改动**：

1. **P0：renderer 归档后台化**。server tar.gz 验签解压完成即 spawn server；renderer tar.gz 的解压挪到 server boot 的同时进行（主窗口加载依赖 renderer artifact，须在 `createMainWindow` 前完成——与 A4 组合时天然被 overlap）。收益：首启关键路径只剩 158M 解压。
2. **P2：tar.gz 用后清理**。boot sentinel 确认健康（`artifact-boot.cjs:510-518` 的 60s 清除点）后，best-effort 删除 `$INSTDIR/resources/seed/*.tar.gz`：
   - 保留 `seed-train-*.json(.sig)` manifest（3-strikes demote 与版本判定依赖）；
   - **必须先处理 demote 回退路径**：删了 tar.gz 后 seed 重新激活不可用，需确认回退链为「上一版本 artifact 目录 → OTA 重新下载」，manifest 中补记录归档 sha256 供 OTA 完整性校验（`release-digest.v2.json` 已有基础设施）；
   - 机器级安装 `$INSTDIR` 可能不可写，删除失败静默忽略（只省用户级安装的 232 MB 磁盘）。

### A6. Defender 排除引导（P3，可选）

启动耗时诊断（现有 `gpu-startup.json` + launch.log）检测到 server import 段超阈值（如 >20s）且 OS 为 Windows 时，在设置-诊断面板展示一次性引导：建议把 `JARVIS_HOME` 与安装目录加入 Defender 排除项，附可复制的 PowerShell 命令（自动添加需管理员+弹 UAC，不做自动）。不主动改用户安全配置，仅提示。

---

## §6 B 组：安装包体积优化

### B1. ASR/TTS 模型按需下载（P2，体积主力）

**现状**：345 MB 模型（SenseVoice 229M + zh TTS 116M）无条件进包。但基础设施已经齐备：
- 模型本来就是**请求级 spawn**，零启动耦合；
- `/api/sherpa/status`（`server/routes/sherpa.ts:19-70`）已上报 per-language `localAsr/localTts` 就绪态，UI（`SherpaConfigPanel.tsx`）已展示；
- 缺模型时自动回退 Edge TTS / 云 ASR（`core/tts-service.ts:14`）；
- `scripts/download-sherpa-onnx.mjs` 已有带 sha256 校验的下载+解压实现（构建期用）。

**改动**：

1. **模型清单外置**：把 `download-sherpa-onnx.mjs` 的 MODELS 常量（URL/sha256/目录映射）抽到 `shared/sherpa-models.json`，构建脚本与运行时共用，杜绝两处漂移。
2. **extraResources filter 追加排除**（`package.json`）：
   ```
   "!**/models/asr/sense-voice/**",
   "!**/models/tts/zh/**"
   ```
   运行时只留 bin + onnxruntime.dll + silero VAD（sherpa 部分 390M → ~50M）。保留 `stage:sherpa --models` 构建 flag，供需要全离线的发布形态（Store 审核备份、企业包）。
3. **server 端下载器**：新增 `lib/speech-model-downloader/`：
   - `POST /api/sherpa/models/install` `{kind: "asr"|"tts", lang}` → 后台任务：下载 tar.bz2 → sha256 校验（清单来自 shared JSON）→ 解压到 `JARVIS_HOME/speech-models/<os-arch>/<kind>/<dir>/` → 幂等（已存在即 no-op）；
   - `GET /api/sherpa/models/install/status` 供 UI 轮询进度（复用现有任务/进度模式）；
   - 下载源：默认 GitHub releases（现成 pinned URL），**备选 AtomGit 镜像**（`scripts/mirror-release-to-atomgit.mjs` 已有镜像管道，把模型一并镜像，解决国内可达性）。
4. **路径解析接入**：`core/realtime-voice/sherpa-paths.ts` 的 `resolveSherpaDir()` 优先级链插入一级：`prefs sherpa.dir → credentials.baseUrl → JARVIS_SHERPA_DIR → JARVIS_HOME/speech-models/<os-arch> → bundledSherpaBase()`。模型落 JARVIS_HOME 后无需改 prefs，自动被发现；`/api/sherpa/status` 的就绪检查同步认这个目录。
5. **UI**：`SherpaConfigPanel.tsx` 增加"下载本地语音模型（约 345 MB）"按钮 + 进度条 + 失败重试；语音设置页在模型未就绪时展示同一入口（现在只显示"不可用"）。

**预期**：安装包 697 → **约 460~490 MB**；win-unpacked -345 MB。首次启用语音多一次 345 MB 下载（进度可见、可断点重试）。

### B2. 更小的内置模型（P3，仅当坚持内置时做）

| 项 | 现模型 | 候选 | 体积 | 代价 |
|---|---|---|---|---|
| zh TTS | vits-zh-hf-fanchen-C 116 MB | piper 兼容 zh_CN-huayan-medium | ~63 MB | 音色更换，需人耳评审 |
| ASR | SenseVoice int8 229 MB（zh/en/ja/ko/yue 通吃） | zipformer bilingual zh-en int8 | ~70 MB | **丢 ja/ko**；或 whisper-base int8 ~80 MB（四语，中文准确率下降） |

结论：ASR 不建议换（SenseVoice 的多语通吃 + 中文质量是当前最优解）；TTS 若评审通过可省 53 MB。**B1 落地后本项优先级进一步降低**（按需下载场景下 345 MB 不占安装包）。

### B3. MinGit 按需化（P3）

**现状**：MinGit 91 MB 无条件进包（win extraResources），但启动不碰 git，仅 agent 工具 shell 需要 PATH 里的 git（`main.cjs:1786-1800` 只做 PATH 前置）。

**改动**：
1. 启动时探测系统 git（`git --version`，Windows 常见已装）；有则 PATH 用系统的，不占安装包；
2. 无系统 git 时，首次需要 git 的会话前触发下载 MinGit 到 `JARVIS_HOME/runtime/git/`（复用 B1 的下载器骨架与 sha256 校验；GitHub/AtomGit 双源）；
3. `resources/git` 从 extraResources 移除，升级安装的 `jarvisRemoveOwnedInstallTrees` 已会清理旧树。

**预期**：安装包 -60~70 MB。风险：企业内网无 git 且无外网 → 首次 agent shell 报缺 git，提示安装（可接受，属长尾场景）。

### B4. im-web canvaskit 外置（P3）

**现状**：im/build/web 61 MB 中 canvaskit 占 42 MB，且 Flutter 默认随包捆绑。

**改动**：Flutter build 换用 `--dart-define=FLUTTER_WEB_CANVASKIT_URL`（指向 CDN 或 server 同域静态路径），安装包不再带 canvaskit；离线兜底：server 启动时若检测本地无 canvaskit 且无外网，im-web 降级提示。预期 -30~42 MB。

### B5. 其他审计（P3）

- `resources/assets` 32 MB：逐项审计是否有未引用的大图（generate-screenshot-previews 等产物混入）。
- `app.asar` 41 MB：检查 desktop/src 静态资源 filter 是否漏排除 map 文件。
- NSIS 已是 `compression: maximum` + lzma，不再动（installer.nsh 注释明确 /SOLID 冲突，勿改）。

---

## §7 分阶段实施计划

### P0 — 快赢（预计 1~2 天）✅ 已落地（2026-11-05）

| 项 | 交付 | 验证 |
|---|---|---|
| A1 | `server/bootstrap.ts` enableCompileCache（缓存落 `JARVIS_HOME/cache/v8-compile`，`NODE_DISABLE_COMPILE_CACHE=1` 可关）+ import 耗时日志 | 机制冒烟通过（Node 26 cache 落盘）；量化对比待参照机 |
| A5.1 | renderer 归档后台解压：`artifact-boot.cjs` 新增 `prepareArtifactBootDeferred` + renderer `onDecision` 决策快照；`main.cjs` `resolvePackagedArtifactBoot` 只等 server 半场、`_spawnServerOnce` 的 `JARVIS_RENDERER_DIST` 改读决策快照、`startServer` 末尾兑现 `rendererReady`；GC 后台化 | artifact-boot / channel-consistency / OTA 等 178 例全绿；主进程 bundle 构建通过 |
| 基线采集 | boot-summary 三处计时：`[server-bootstrap] import completed in Xs`、`spawnToReadyMs`、`startServerTotalMs`；首启 renderer 半场耗时并入 `renderer artifact resolved` 行 | 参照机首启/二启各 3 次取中位数（待做） |

### P1 — 启动主力（预计 1~2 周）✅ 已落地（2026-11-05）

| 项 | 交付 | 验证 |
|---|---|---|
| A2 | **实测驱动重定向**：nft prune 后 21,514 个文件中仅 3,923 个在冷启动 import 面上（其余为懒加载/插件运行时）。落地：jsdom 解析链（~930 文件，web-reader 唯一静态导入点改动态 import）+ qrcode（~35 文件）移出冷启动图 → **import 面 3,923 → 2,853（-27%）**。PI SDK（1,484 文件）保持 external：jiti 动态加载/变量 require 风险高、且产物正确性由 CI node24 ABI 决定，不冒险 | 重建 + 真实 boot smoke 通过（`registerHooks` 计数实测）；盘面文件数不动（懒加载需要） |
| A3 | `engine.init()` 拆 critical / `runBackgroundInit()`：后台化 4 项自包含收尾（skills watcher 热重载、bridge reconcile、ephemeral 清理、file-history watcher）；`JARVIS_EARLY_READY=0` 一键回退。保守边界（依据 init 全图风险矩阵）：迁移/runtimeContext/models/agents/skills 同步/channel repair 留 critical——agents 的 factStore 被大量路由直接触碰、channel repair 必须先于 hub scheduler | 真实 boot smoke：`ready: port=` 先于 `✿ 后台初始化完成` |
| A4 | 主窗口先行：`startServer()` 改为 `serverBootPromise` 不先 await；`isSetupComplete()` 本地为真时等 renderer artifact 半场（`waitForRendererBootHandle`）即建窗，renderer 加载与 server 冷 import 并行；onboarding/教程路径保持串行（需 server 做迁移判定）。renderer 侧 `app-init.ts` 端口为 null 时轮询等待（120s 上限，超时走原 serverNotReady 路径） | main bundle + renderer 构建通过；GPU contract 测试同步更新（`const serverBootPromise = startServer();` 契约） |

### P2 — 体积主力（预计 2~3 周）✅ 已落地（2026-11-05）

| 项 | 交付 | 验证 |
|---|---|---|
| B1 | ① `shared/sherpa-models.json` 单一清单（URL/pinned + verify sha256，从 vendor 实测计算；构建脚本与运行时共用）；② `lib/sherpa/model-downloader.ts`（fetch 流式+curl 兜底、系统 tar 解压——Windows 显式 System32 bsdtar 防 GNU tar "C:" 陷阱、解压展平、verify、幂等、单飞行）；③ `/api/sherpa/models/{available,install,install/status}` 三端点；④ `sherpa-paths.ts` 多根解析（引擎目录 → `JARVIS_HOME/speech-models/<os-arch>`），TTS/ASR 适配器与 status 路由接入；⑤ `SherpaConfigPanel` 下载区 + 进度轮询（7 locale i18n）；⑥ extraResources 排除全部模型、`stage:sherpa` 不再下载模型（新增 `stage:sherpa:models` 供全离线构建）。**预期安装包 697 → 约 460~490 MB（待 CI 实测 NSIS）** | 下载器真实 tar.bz2 链路测试 2 例（成功/哈希篡改）；启动 smoke 通过；typecheck/locale-parity 干净 |
| A5.2 | 稳定 boot（未激活 seed、无崩溃回退）90s 后 best-effort 清理 `resources/seed/*.tar.gz`（-232MB 磁盘；manifest+.sig 保留）；恢复链改造：激活分支对归档缺失给明确"重装/OTA"报错（不再是 tar 层模糊错误）；`repairArtifacts` 前置守卫（归档缺失 → 拒绝清空 artifacts + 引导文案，dialog + `--repair-artifacts` 两条路径） | node --check；全量测试 |

### P3 — 二梯队 ✅ 部分落地（2026-11-05）

| 项 | 结论 | 交付 |
|---|---|---|
| B2 | **人工评审项，未动代码**：ASR 不换（SenseVoice 多语通吃最优）；TTS piper huayan 需人耳评审。B1 落地后按需下载使模型体积不进安装包，本项优先级进一步降低 | — |
| B3 | lite 落地：git 运行时解析链改为 `JARVIS_HOME/runtime/git`（按需下载的目标落点）→ `resources/git`（当前仍随包）。**MinGit 下载器未实现**（需自包含 zip 下载+解压，~80 行），列为后续项 | main.cjs PATH 链 |
| B4 | **否决（有记录）**：canvaskit 外置到 CDN 断网即白屏（与离线优先冲突）；指向 server 同域 = 仍随包、无体积收益。im-web 维持现状 | — |
| B5 | **审计完成，不动**：assets 32MB 为产品内容（cover-gallery 22M/角色卡/纹理），非构建残留；screenshot-themes 644K。可选后续：图片压缩 pass | — |
| A6 | lite 落地：`spawnToReadyMs > 20s` 时向诊断日志写 Defender 排除引导（不弹窗、不自动改用户安全配置） | main.cjs |

---

## §8 测试方案

**启动计时（统一口径）**

- 数据源（全部现成）：`diagnostics/desktop-launch/launch.log`（shell 阶段）、`user/gpu-startup.json`（GPU/窗口阶段）、server stdout `[server-bootstrap]` import 计时与 `✿ 初始化完成（Xs）`（init 阶段）。
- 新增：bootstrap 汇总一行 `boot-summary: import=Xs init=Ys ready=Zs`（A1 改动时顺手加，写入 launch.log），避免人工拼四个日志源。
- 场景矩阵：{首启, 二次, 升级覆盖} × {Defender 开, 关} × {3 台参照机}，每格 3 次取中位数。

**体积**

- CI dist job 末尾打印 installer/win-unpacked/dist-server 文件数与体积，防回潮（脚本化，10 行）。

**B1 专项**

- 单测：清单 sha256 校验、解压目标路径、幂等重入、磁盘满/断网/镜像切换；
- 集成：下载完成后 `/api/sherpa/status` 变 ready、真实 TTS/ASR 请求走通；删掉 JARVIS_HOME/speech-models 后回退 Edge TTS；
- 路径：`JARVIS_SHERPA_DIR` 用户配置仍最高优先（不被下载目录覆盖）。

**A3 专项**

- 503 契约：critical 前/后各路由状态快照测试；background 未完成时 skills 相关路由行为；
- 回退开关：`JARVIS_EARLY_READY=0` 行为与旧版逐字节一致。

---

## §9 验收标准（DoD）

1. 安装包 ≤ 500 MB（B1 合入后）；win-unpacked ≤ 900 MB；首启后磁盘总占用 ≤ 1.1 GB（A5.2 后）。
2. 参照机"常规档"二次冷启动（Defender 开）：server-info 就绪 ≤ 15s、app-ready ≤ 20s；较基线提升 ≥ 3 倍。
3. 首启 preparing 段耗时 ≤ 基线的 60%（A5.1）。
4. 语音功能回归：按需下载→本地 TTS/ASR 走通；未下载时 Edge TTS/云 ASR 自动兜底；`JARVIS_SHERPA_DIR` 与内置全量构建（stage:sherpa --models）两条路径不回归。
5. 3-strikes demote → 上一版本/OTA 回退链在删 tar.gz 后仍可用（A5.2）。
6. `npm test` 全绿；server smoke 通过；boot-summary 日志出现在 launch.log。

---

## §10 风险与回滚

| 项 | 风险 | 缓解 / 回滚 |
|---|---|---|
| A1 | compile cache 目录膨胀/损坏 | Node 自动忽略坏缓存；JARVIS_HOME 清理策略覆盖；`NODE_DISABLE_COMPILE_CACHE=1` 可关 |
| A2 | 内联破坏 SDK 运行时文件查找 | 逐包内联+smoke；external 分类表进 PR；出问题单包回退 external |
| A3 | 提前就绪后部分路由能力未就绪 | backgroundReady 状态 + 503 契约测试；`JARVIS_EARLY_READY=0` 一键回退 |
| A4 | 低端机窗口与 server 抢资源负收益 | 实测 gating，必要时按机器能力启用 |
| A5.2 | 删 tar.gz 破坏 demote 回退 | 改造回退链先行（P2 内）；manifest 校验兜底；灰度观察一个版本 |
| B1 | GitHub 不可达 / 下载半途中断 | AtomGit 镜像 + 断点重试 + 云语音兜底；sha256 防脏数据；内置全量构建 flag 保留 |
| B3 | 无 git 无外网环境 agent shell 不可用 | 明确报错引导；保留系统 git 探测优先 |

---

## §11 附录

### 11.1 关键文件索引

| 主题 | 文件 |
|---|---|
| 打包配置/extraResources filter | `package.json` `build` 段（sherpa filter 约 :198-222） |
| NSIS 钩子（安装面校验/ACE/进程清理） | `build/installer.nsh` |
| 模型清单与下载 | `scripts/download-sherpa-onnx.mjs`（MODELS :63-81） |
| server 构建/external/nft prune | `scripts/build-server.mjs`、`scripts/build-server-phases.mjs` |
| server 引导/import | `server/bootstrap.ts` |
| 就绪点 | `server/index.ts:1231-1252`（server-info.json 写入）、`:388-405`（503 early-bind） |
| engine.init 串行段 | `core/engine.ts:2423-2759` |
| artifact 首启解压 | `desktop/main.cjs:1420-1508`、`desktop/src/shared/artifact-boot.cjs`、`shared/artifact-core/activation.cjs` |
| server spawn / PATH 前置 | `desktop/main.cjs:1786-1923` |
| 主窗口创建时机 | `desktop/main.cjs` whenReady 编排（:6096-6287）、splash 关闭（:6055-6093） |
| sherpa 路径解析（B1 接入点） | `core/realtime-voice/sherpa-paths.ts`（resolveSherpaDir / userSherpaModelsBase / resolveSherpaModelDirMultiRoot） |
| B1 模型清单（单一数据源） | `shared/sherpa-models.json`（构建脚本 + 运行时下载器共用） |
| B1 运行时下载器 | `lib/sherpa/model-downloader.ts` |
| B1 下载 API/UI | `server/routes/sherpa.ts`（available/install/status）、`desktop/src/react/settings/tabs/media/SherpaConfigPanel.tsx` |
| A5.2 清理/守卫 | `desktop/main.cjs`（scheduleSeedArchiveCleanup / _bootUsedSeedActivation）、`desktop/src/shared/artifact-boot.cjs`（seedArchivesPresent + 激活分支报错）、`desktop/src/shared/artifact-repair.cjs`（skippedReason 守卫） |
| A4 窗口先行 | `desktop/main.cjs`（waitForRendererBootHandle / whenReady earlyMainWindow）、`desktop/src/react/app-init.ts`（端口等待循环） |
| A2 懒加载点 | `lib/tools/web-reader.ts`（jsdom）、`lib/bridge/wechat-login.ts` + `server/routes/access.ts`（qrcode） |
| A3 init 拆分 | `core/engine.ts`（runBackgroundInit）、`server/index.ts`（JARVIS_EARLY_READY 分支） |
| A1 compile cache | `server/bootstrap.ts` |
| 测试 | `tests/sherpa-model-downloader.test.ts`、`tests/artifact-boot.test.ts`（deferred/onDecision 组）、`tests/artifact-boot-channel-consistency.test.ts`（deferred 桩）、`tests/desktop-main-gpu-startup-contract.test.ts` |
| TTS/ASR 适配器（请求级 spawn 证据） | `core/tts/adapters.ts:352-391`、`core/speech-recognition/adapters.ts:174-239` |
| 就绪状态 API | `server/routes/sherpa.ts:19-70` |
| 语音设置 UI | `desktop/src/react/settings/tabs/media/SherpaConfigPanel.tsx` |
| AtomGit 镜像管道 | `scripts/mirror-release-to-atomgit.mjs` |

### 11.2 基线明细（2026-11-05 实测）

- 安装包 `dist/Bit Jarvis-0.0.2-Windows-x64.exe` = 697 MB；`dist/win-unpacked` = 1.2 GB。
- `vendor/sherpa-onnx/win32-x64` = 909 MB（kokoro 408M + ko 78M 被 filter 排除，包内 390 MB）。
- `dist-server/win-x64` = 411 MB，node_modules = 21,514 文件；seed 归档 server 158 MB / renderer 74 MB。
- MinGit 91 MB；im-web 61 MB（canvaskit 42 MB）；app.asar 41 MB；assets 32 MB；Electron（裁剪 locales 后）~304 MB。
- Node 运行时 v26.8.2（`module.enableCompileCache` 自 22.8 起可用 ✓）。
- 历史问题：#719 / #736（Defender 下冷 import 超 60s，keepalive worker 即为此而设）。

### 11.3 变更记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-11-05 | v1.0 | 初版：基线实测 + 根因 R1-R4/S1-S4 + 方案 A1-A6/B1-B6 + P0-P3 计划 |
| 2026-11-05 | v1.1 | P0 落地：A1 compile cache（bootstrap.ts）、A5.1 renderer 解压后台化（`prepareArtifactBootDeferred` + 决策快照 + main.cjs deferred 接线）、boot-summary 三处计时；178 例测试全绿；顺手修复 gpu-startup contract 测试的过期日志字符串（存量问题，HEAD 中已红） |
| 2026-11-05 | v1.2 | P1/P2/P3 落地：A2（实测重定向：import 面 3,923→2,853；jsdom/qrcode 懒加载；PI SDK 保持 external 的数据与理由）、A3（critical/background 拆分 + `JARVIS_EARLY_READY`）、A4（主窗口先行 + app-init 端口等待）、B1（清单/下载器/三端点/多根解析/UI/i18n/构建排除）、A5.2（归档清理 + repair 守卫 + 明确报错）、B3-lite/A6-lite；B4 否决（离线优先）、B5 审计不动、B2 留人工评审。新增测试：下载器真实 tar.bz2 链路 2 例。实测：正确 runtime（捆绑 node24）下 boot smoke 通过、`ready` 先于后台 init、compile cache ENABLED；**本地构建用系统 node26 会产生 ABI 137/147 不匹配——CI 用 node24，属环境差异非代码问题** |

### 11.4 落地实测数据（2026-11-05，工作区）

- 冷启动 import 面（`module.registerHooks` 计数，bundle 静态图）：**3,923 → 2,853 文件**（-27%）；冷启动大头：pi-coding-agent 1,484（external，见 A2）、typebox 668（PI 依赖）、undici 110、yaml 72。
- boot smoke（`dist-server/win-x64` + 一次性 JARVIS_HOME + `JARVIS_PORT`）：`import completed in 3.9~5.1s`、`初始化完成 0.6~0.9s` → `ready: port=` → `后台初始化完成`（A3 时序 ✓）、`compile cache status=1`（ENABLED，Node 枚举 FAILED=0/ENABLED=1/ALREADY_ENABLED=2/DISABLED=3）。
- 下载器测试走真实 tar.bz2（System32 bsdtar 打包/解包对拍）+ 本地 http fixture。
- **全量测试套件判定**（11,263 例：10,865 通过 / 358 失败 / 74 文件）：358 例失败与本次改动无关，已逐类归因——① 环境性：仓库 engines 锁 node 24，系统 node 26 下 repo 根 better-sqlite3 ABI 加载失败 → session-manifest/fact-store/file-history/persistence 等整个 sqlite 族失败；② 存量合同漂移：`.github/workflows` 不在工作树（package-build-order）、安装器改名 Bit Jarvis 后 windows-installer-contract 仍断言旧字符串、shutdownServer 源码漂移、tts secMsGec 格式、open-boundary ratchet 存量债务（lint CLI 确认本次新文件零新增 violation）。**本次改动直接相关的全部套件在全量跑中通过**：artifact-boot 50 ✓、channel-consistency 11 ✓、sherpa-model-downloader 2 ✓、artifact-ota 100 ✓、gpu-startup contract 10 ✓、foreign-server-guard 3 ✓。
- 待 CI 实测：NSIS 安装包体积（B1 后预期 697 → 约 460~490 MB）、Defender 开/关双测、三档参照机 boot-summary。
