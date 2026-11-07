/**
 * Agent — 一个助手实例
 *
 * 拥有自己的身份、人格、记忆、工具和 prompt 拼装逻辑。
 * Engine 持有一个 Agent，未来可以持有多个。
 */
import fs from "fs";
import path from "path";
import { loadConfig, saveConfig } from "../lib/memory/config-loader.ts";
import { safeReadFile, safeReadJSON } from "../shared/safe-fs.ts";
import { resolvePersonaSource } from "./persona-source.ts";
import { getAgentPromptPack } from "./agent-prompt-text.ts";
import {
  resolvePromptLang,
  resolveTemplatePath,
  type PromptLang,
} from "../shared/prompt-locale.ts";
import { FactStore } from "../lib/memory/fact-store.ts";
import { SessionSummaryManager } from "../lib/memory/session-summary.ts";
import { createMemoryTicker } from "../lib/memory/memory-ticker.ts";
import { createMemorySearchTool } from "../lib/memory/memory-search.ts";
import { createWebSearchTool } from "../lib/tools/web-search.ts";
import { createTodoTool } from "../lib/tools/todo.ts";
import { createDeskManager } from "../lib/desk/desk-manager.ts";
import { CronStore } from "../lib/desk/cron-store.ts";
import { createAutomationTool } from "../lib/tools/automation-tool.ts";
import { createWebFetchTool } from "../lib/tools/web-fetch.ts";
import { createStageFilesTool } from "../lib/tools/output-file-tool.ts";
import { createFileTool } from "../lib/tools/file-tool.ts";
import { createChannelTool } from "../lib/tools/channel-tool.ts";
import { createBrowserTool } from "../lib/tools/browser-tool.ts";
import { createComputerUseTool } from "../lib/tools/computer-use-tool.ts";
import { createPinnedMemoryTools } from "../lib/tools/pinned-memory.ts";
import { createExperienceTools } from "../lib/tools/experience.ts";
import { createInstallSkillTool } from "../lib/tools/install-skill.ts";
import { createNotifyTool } from "../lib/tools/notify-tool.ts";
import { createUpdateSettingsTool } from "../lib/tools/update-settings-tool.ts";
import { createSessionFoldersTool } from "../lib/tools/session-folders-tool.ts";
import {
  createSubagentCloseTool,
  createSubagentReplyTool,
  createSubagentTool,
} from "../lib/tools/subagent-tool.ts";
import { createCheckDeferredTool } from "../lib/tools/check-deferred-tool.ts";
import { createLoopControlTool } from "../lib/tools/loop-control-tool.ts";
import { createStopTaskTool } from "../lib/tools/stop-task-tool.ts";
import { createCurrentStatusTool } from "../lib/tools/current-status-tool.ts";
import { createWorkflowTool } from "../lib/tools/workflow-tool.ts";
import { createCardGuideTool } from "../lib/tools/card-guide-tool.ts";
import { createSessionTool } from "../lib/tools/session-tool.ts";
import { createShowCardTool } from "../lib/tools/show-card-tool.ts";
import { runCompatChecks } from "../lib/compat/index.ts";
import { getPlatformPromptNote } from "./platform-prompt.ts";
import { assertAgentConfigPatchYuan, getAgentConfigRepairState } from "./yuan-registry.ts";
import { callText } from "./llm-client.ts";
import { createModuleLogger } from "../lib/debug-log.ts";
import {
  CACHE_SNAPSHOT_EXPERIMENT_ID,
  PROACTIVE_SUBAGENT_EXPERIMENT_ID,
  getResolvedExperimentValue,
} from "../lib/experiments/registry.ts";
import { userProfilePath } from "../lib/user-profile-store.ts";
import {
  type AgentAppearanceModel,
  formatAgentAppearancePrompt,
  hasAgentAppearanceSummaryCapability,
  readAgentAppearanceProfileResource,
  type ResolvedAgentAppearanceModelConfig,
  refreshAgentAppearanceProfileResource,
} from "../lib/agent-appearance-summary.ts";

const moduleLog = createModuleLogger("agent");

type AgentAppearanceEngine = {
  resolveVisionConfig?: () => ResolvedAgentAppearanceModelConfig | null;
  resolveVisionConfigFresh?: () => Promise<ResolvedAgentAppearanceModelConfig | null>;
  currentModel?: AgentAppearanceModel | null;
  resolveModelWithCredentials?: (modelRef: unknown) => ResolvedAgentAppearanceModelConfig | null;
  resolveModelWithCredentialsFresh?: (modelRef: unknown) => Promise<ResolvedAgentAppearanceModelConfig | null>;
  usageLedger?: unknown;
};

type RefreshAppearanceSummaryOptions = {
  targetModel?: AgentAppearanceModel | null;
  signal?: AbortSignal;
  rebuildSystemPrompt?: boolean;
};

type BuildSystemPromptOptions = {
  forSubagent?: boolean;
  forceMemoryEnabled?: boolean;
  forceExperienceEnabled?: boolean;
  targetModel?: AgentAppearanceModel | null;
};

export class Agent {
  declare _automationTool: any;
  declare _browserTool: any;
  declare _cb: any;
  declare _channelPostHandler: any;
  declare _channelTool: any;
  declare _checkDeferredTool: any;
  declare _loopControlTool: any;
  declare _computerUseTool: any;
  declare _config: any;
  declare _cronStore: any;
  declare _currentStatusTool: any;
  declare _descriptionRefreshHandler: any;
  declare _deskManager: any;
  declare _disposing: any;
  declare _dmSentHandler: any;
  declare _enabledSkills: any;
  declare _experienceEnabled: any;
  declare _experienceTools: any;
  declare _factStore: any;
  declare _getOwnerIds: any;
  declare _installSkillTool: any;
  declare _listAgents: any;
  declare _memoryMasterEnabled: any;
  declare _memoryModel: any;
  declare _memorySearchTool: any;
  declare _memorySessionEnabled: any;
  declare _memoryTicker: any;
  declare _notifyHandler: any;
  declare _notifyTool: any;
  declare _onInstallCallback: any;
  declare _pinnedMemoryTools: any;
  declare _repairState: any;
  declare _resolveModel: any;
  declare _resolveModelFresh: any;
  declare _runtimeInitialized: any;
  declare _searchConfigResolver: any;
  declare _sessionFoldersTool: any;
  declare _sessionTool: any;
  declare _stageFilesTool: any;
  declare _fileTool: any;
  declare _stopTaskTool: any;
  declare _subagentCloseTool: any;
  declare _subagentReplyTool: any;
  declare _subagentTool: any;
  declare _summaryManager: any;
  declare _systemPrompt: any;
  declare _todoTool: any;
  declare _updateSettingsTool: any;
  declare _utilityModel: any;
  declare _webFetchTool: any;
  declare _webSearchTool: any;
  declare _cardGuideTool: any;
  declare _showCardTool: any;
  declare _workflowTool: any;
  declare agentDir: any;
  declare agentName: any;
  declare agentsDir: any;
  declare channelsDir: any;
  declare configPath: any;
  declare deskDir: any;
  declare factsDbPath: any;
  declare factsMdPath: any;
  declare id: any;
  declare longtermMdPath: any;
  declare memoryMdPath: any;
  declare productDir: any;
  declare sessionDir: any;
  declare summariesDir: any;
  declare todayMdPath: any;
  declare userDir: any;
  declare userName: any;
  declare weekMdPath: any;
  /**
   * @param {object} opts
   * @param {string} opts.id         - 助手 ID（唯一信源，等于数据目录名）
   * @param {string} opts.agentsDir  - 所有助手的父目录（从中派生 agentDir）
   * @param {string} opts.productDir - 产品模板目录（ishiki.example.md, yuan 模板等）
   * @param {string} opts.userDir    - 用户数据目录（user.md, 用户头像）—— 跨助手共享
   */
  constructor({ id, agentsDir, productDir, userDir, channelsDir, searchConfigResolver }) {
    if (!id) throw new Error("Agent: id is required");
    if (!agentsDir) throw new Error("Agent: agentsDir is required");

    // id 是唯一信源；agentDir 是其派生值（不再作为构造参数）。
    // 所有持有 Agent 实例的地方通过 agent.id 识别身份，
    // 需要磁盘路径时读 agent.agentDir（或从它派生的 sessionDir / configPath 等）。
    this.id = id;
    this.agentsDir = agentsDir;
    this.agentDir = path.join(agentsDir, id);
    this.productDir = productDir;
    this.userDir = userDir;
    this.channelsDir = channelsDir || null;
    this._searchConfigResolver = searchConfigResolver || null;

    // 路径（全部从 this.agentDir 派生）
    this.configPath = path.join(this.agentDir, "config.yaml");
    this.factsDbPath = path.join(this.agentDir, "memory", "facts.db");
    this.memoryMdPath = path.join(this.agentDir, "memory", "memory.md");
    this.todayMdPath = path.join(this.agentDir, "memory", "today.md");
    this.weekMdPath = path.join(this.agentDir, "memory", "week.md");
    this.longtermMdPath = path.join(this.agentDir, "memory", "longterm.md");
    this.factsMdPath = path.join(this.agentDir, "memory", "facts.md");
    this.summariesDir = path.join(this.agentDir, "memory", "summaries");
    this.sessionDir = path.join(this.agentDir, "sessions");
    this.deskDir = path.join(this.agentDir, "desk");

    // 身份（init 后从 config 填充）
    this.userName = "User";
    this.agentName = "Jarvis";

    // 运行时状态
    this._config = null;
    this._factStore = null;
    this._summaryManager = null;
    this._memoryTicker = null;
    this._memorySearchTool = null;
    this._webSearchTool = null;
    this._webFetchTool = null;
    this._todoTool = null;
    this._pinnedMemoryTools = [];
    this._experienceTools = [];
    this._memoryMasterEnabled = true;   // agent 级别总开关（config.yaml memory.enabled）
    this._memorySessionEnabled = true;  // per-session 开关（WelcomeScreen toggle）
    this._experienceEnabled = false;    // agent 级别经验能力开关（config.yaml experience.enabled，默认关闭）
    this._enabledSkills = [];
    this._systemPrompt = "";
    this._descriptionRefreshHandler = null;
    this._runtimeInitialized = false;
    this._repairState = null;

    // Desk 系统（与 memory 完全独立）
    this._deskManager = null;
    this._cronStore = null;
    this._automationTool = null;
    this._stageFilesTool = null;
    this._fileTool = null;
    this._channelTool = null;
    this._browserTool = null;
    this._computerUseTool = null;
    this._notifyTool = null;
    this._stopTaskTool = null;
    this._subagentTool = null;
    this._subagentReplyTool = null;
    this._subagentCloseTool = null;
    this._cardGuideTool = null;
    this._showCardTool = null;
    this._sessionTool = null;
    this._workflowTool = null;
    this._currentStatusTool = null;
    this._loopControlTool = null;

    /**
     * 外部回调注入（由 AgentManager._createAgentInstance 填充）。
     * Agent 不持有 Engine 引用，所有对 Engine 的需求通过此对象间接访问。
     */
    this._cb = null;

    // 团队花名册唯一事实源：AgentManager 注入的 active-agent provider，
    // tombstone / 坏目录已在 manager 层过滤。Agent 自身禁止私扫 agentsDir，
    // 否则删除标记对 prompt / subagent / DM / workflow 不可见（#1657 / #1633）。
    // 与旧行为保持一致：仅在频道能力可用（channelsDir 存在）时暴露花名册。
    if (this.channelsDir && this.agentsDir) {
      this._listAgents = () => this._cb?.listActiveAgents?.() ?? [];
    }
  }

  // ════════════════════════════
  //  生命周期
  // ════════════════════════════

  /**
   * 初始化助手：加载配置、编译记忆、创建工具
   * @param {(msg: string) => void} [log]
   * @param {object} [sharedModels] - 全局共享模型配置（由 engine 传入）
   * @param {(bareId: string, agentConfig: object) => object} [resolveModel] - 统一模型解析回调
   */
  /**
   * 解析这个 agent 的 prompt 语言：config.locale（显式手工覆盖）→ 全局 prefs
   * 的 locale → "en"。agent 的 config.yaml 没有任何代码会写 locale 字段，缺失
   * 是常态而非异常；不写回 config，否则会把用户日后在设置里切换的全局语言
   * 锁死在这个 agent 身上。两级都缺时落 "en"：没有任何信号时给更保守的默认，
   * 而不是猜中文。
   *
   * 返回原始 locale 字符串（如 "zh-CN"、"ja"），不做归一化——各读点仍用
   * `.startsWith("zh")` 做模板二分：locale 以 "zh" 开头（zh-CN/zh-TW/zh-HK 等
   * 简繁体）→ zh 模板，其余一切语言（ja、ko、en……）→ en 模板。第三语言 UI
   * 用户拿到英文 prompt 模板是有意的设计取舍，不是 bug。
   */
  resolveLocale() {
    const explicit = typeof this._config?.locale === "string" ? this._config.locale.trim() : "";
    if (explicit) return explicit;
    const global_ = typeof this._cb?.getLocale === "function" ? String(this._cb.getLocale() || "").trim() : "";
    if (global_) return global_;
    return "en";
  }

  /**
   * 这个 agent 当前使用的 prompt 语言。
   *
   * 解析链（见 docs/AGENT_I18N.md §4.1）：
   *   用户强制覆盖 → Agent locale → 模型语言能力过滤 → en 兜底
   *
   * 只影响文案与模板选择，不约束模型内部 reasoning 语言。
   */
  _promptLang(): PromptLang {
    return resolvePromptLang({
      agentLocale: this.resolveLocale(),
      override: this._cb?.getAgentPromptLocale?.(),
      modelLanguages: this._cb?.getModelLanguages?.(this._config?.models?.chat),
    }).lang;
  }

  /**
   * 解析用户的名字：全局 prefs 的 userName → 按语言兜底（中文 "用户"，其余
   * "User"）。
   *
   * 名字描述的是使用者本人，不是某个 agent 的属性：一个用户就一个名字。用户在
   * 设置里改一次称呼，所有 agent 都得跟着改口，不能出现 A 叫得对、B 还用旧称呼
   * 的情况，所以唯一正源是全局 preferences，这里不读 agent config。曾经存在的
   * agent 级 user.name 覆盖层已经取消，残留字段由迁移清掉。
   */
  resolveUserName() {
    const global_ = typeof this._cb?.getUserName === "function" ? String(this._cb.getUserName() || "").trim() : "";
    if (global_) return global_;
    return getAgentPromptPack(this._promptLang()).userNameFallback;
  }

  /**
   * 解析这个 agent 的音色：config.agent.voice（显式配置）→ null。
   * 音色是 agent 自身的属性（与 name/yuan 同层），未配置时由调用方回落全局
   * tts.voice / 语言默认音色；这里只负责读出 per-agent 覆盖值，不替全局兜底。
   */
  resolveVoice() {
    const v = this._config?.agent?.voice;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }

  /**
   * 仅加载 config + 身份字段，不碰 FactStore/memoryTicker/tools/runCompatChecks。
   * 供 init() 失败时的 fallback 使用，保证即使完整初始化失败，
   * agent.config.models.chat 仍能被下游正确读取（模型解析 / session 创建）。
   * 抛错表示 config.yaml 本身读不出来（文件缺失或格式损坏）。
   */
  loadConfigOnly() {
    this._config = loadConfig(this.configPath);
    this.userName = this.resolveUserName();
    this.agentName = this._config.agent?.name || "Jarvis";
    this._memoryMasterEnabled = this._config.memory?.enabled !== false;
    this._experienceEnabled = this._config.experience?.enabled === true;
    this._refreshRepairState();
  }

  async init(
    log: (msg?: string) => void = () => { },
    sharedModels: any = {},
    resolveModel = null,
    resolveModelFresh = null,
  ) {
    if (this._runtimeInitialized) return;

    // 0. 兼容性检查（目录、数据库、配置文件）
    await runCompatChecks({
      agentDir: this.agentDir,
      jarvisHome: path.dirname(path.dirname(this.agentDir)),
      log,
    });

    // 1. 加载配置
    log(`  [agent] 1. loadConfig...`);
    this._config = loadConfig(this.configPath);
    log(`  [agent] 1. loadConfig 完成`);

    // 2. 身份 + 记忆总开关
    this.userName = this.resolveUserName();
    this.agentName = this._config.agent?.name || "Jarvis";
    this._memoryMasterEnabled = this._config.memory?.enabled !== false;
    this._experienceEnabled = this._config.experience?.enabled === true;
    this._refreshRepairState();
    if (this._repairState) {
      throw new Error(`Agent config needs repair: ${this._repairState.message}`);
    }

    // 3. 初始化各模块
    log(`  [agent] 3. 模块初始化完成`);

    // 4. 记忆 v2：FactStore + SessionSummaryManager + ticker
    log(`  [agent] 4. FactStore...`);
    fs.mkdirSync(path.join(this.agentDir, "memory", "summaries"), { recursive: true });
    this._factStore = new FactStore(this.factsDbPath);
    this._summaryManager = new SessionSummaryManager(this.summariesDir);

    // v1 → v2 迁移：仅当迁移标记不存在且旧 memories.db 存在时执行一次
    const oldMemoriesPath = path.join(this.agentDir, "memory", "memories.db");
    const migrationDone = path.join(this.agentDir, "memory", ".v2-migrated");
    if (!fs.existsSync(migrationDone) && fs.existsSync(oldMemoriesPath)) {
      try {
        log(`  [agent] 4. v1→v2 迁移: 发现旧 memories.db，开始迁移...`);
        const Database = (await import("better-sqlite3")).default;
        const oldDb = new Database(oldMemoriesPath, { readonly: true });
        const rows = oldDb.prepare("SELECT content, tags, date, created_at FROM memories").all();
        oldDb.close();

        if (rows.length > 0) {
          const facts = rows.map(row => ({
            fact: row.content,
            tags: (() => { try { return JSON.parse(row.tags); } catch { return []; } })(),
            time: row.date ? row.date + "T00:00" : null,
            session_id: "v1-migration",
          }));
          this._factStore.addBatch(facts);
          log(`  [agent] 4. v1→v2 迁移完成: ${facts.length} 条记忆已迁入 facts.db`);
        }
        // 写迁移标记，防止重复迁移
        fs.writeFileSync(migrationDone, new Date().toISOString());
      } catch (err) {
        moduleLog.error(`v1→v2 迁移失败（不影响启动）: ${err.message}`);
        // 迁移失败也写标记，避免每次启动重试
        try { fs.writeFileSync(migrationDone, `failed: ${err.message}`); } catch { }
      }
    }

    log(`  [agent] 4. FactStore + SummaryManager 完成`);

    // utility 模型：用户未配置时 fallback 到聊天模型
    const chatModelRef = this._config.models?.chat || null;
    const userSetUtility = sharedModels.utility || this._config.models?.utility || null;
    const userSetUtilityLarge = sharedModels.utility_large || this._config.models?.utility_large || null;

    this._utilityModel = userSetUtility || chatModelRef;
    this._memoryModel = userSetUtilityLarge || chatModelRef;

    if (!userSetUtility && chatModelRef) {
      moduleLog.log(`utility 模型未配置，使用聊天模型作为工具模型`);
    }
    if (!userSetUtilityLarge && chatModelRef) {
      moduleLog.log(`utility_large 模型未配置，使用聊天模型作为记忆模型`);
    }

    // 保存解析函数：每次 tick 现场调用，拿到最新凭证。
    // 不缓存解析结果——provider key/url/api 变更后 tick 自动恢复，无需重启 agent。
    this._resolveModel = resolveModel || null;
    this._resolveModelFresh = resolveModelFresh || null;

    // 启动时试探性 resolve 一次，只为打一条启动告警（运行时由 ticker 各调用点的 try/catch 处理）
    if (this._memoryModel && this._resolveModel) {
      try {
        this._resolveModel(this._memoryModel, this._config);
      } catch (err) {
        const src = userSetUtilityLarge ? "utility_large" : "聊天模型 fallback";
        moduleLog.warn(`记忆系统暂不可用：${src} 解析失败（改完凭证后 tick 会自动恢复） — ${err.message}`);
        this._cb?.emitDevLog?.(`记忆系统暂不可用：${src} 解析失败 — ${err.message}`, "warn");
      }
    } else if (!this._memoryModel) {
      moduleLog.warn("记忆系统未启动：utility_large 未配置且无聊天模型可 fallback");
      this._cb?.emitDevLog?.("记忆系统未启动：未配置工具模型且无聊天模型可 fallback", "warn");
    }

    if (this._memoryModel && this._resolveModel) {
      log(`  [agent] 4. memoryTicker...`);
      this._memoryTicker = createMemoryTicker({
        summaryManager: this._summaryManager,
        configPath: this.configPath,
        factStore: this._factStore,
        // 现场 resolve：每次 tick 拿到 yaml 最新凭证
        getResolvedMemoryModel: async () => {
          if (!this._resolveModelFresh) {
            throw new Error("fresh memory model resolver is unavailable");
          }
          return {
            ...await this._resolveModelFresh(this._memoryModel, this._config),
            usageLedger: this._cb?.getEngine?.()?.usageLedger,
            usageAgentId: this.id,
          };
        },
        getMemoryMasterEnabled: () => this._memoryMasterEnabled,
        isSessionMemoryEnabled: (sessionPath) => this.isSessionMemoryEnabledFor(sessionPath),
        getTimezone: () => this._cb?.getTimezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone,
        getCacheSnapshotReflectionMode: () => getResolvedExperimentValue(
          this._cb?.getPreferences?.(),
          CACHE_SNAPSHOT_EXPERIMENT_ID,
        ),
        buildSessionCacheSnapshot: (sessionPath, options) => (
          this._cb?.getEngine?.()?.buildSessionCacheSnapshot?.(sessionPath, options)
        ),
        readMemoryReflectionSnapshot: (sessionPath) => (
          this._cb?.getEngine?.()?.getSessionMemoryReflectionSnapshot?.(sessionPath)
        ),
        ensureSessionLoaded: (sessionPath) => (
          this._cb?.getEngine?.()?.ensureSessionLoaded?.(sessionPath)
        ),
        getSessionStreamFn: (sessionPath) => (
          this._cb?.getEngine?.()?.getSessionStreamFn?.(sessionPath)
        ),
        getSessionIdForPath: (sessionPath) => (
          this._cb?.getEngine?.()?.getSessionIdForPath?.(sessionPath)
        ),
        getSessionBranchHeadForPath: (sessionPath) => (
          this._cb?.getEngine?.()?.getSessionBranchHeadForPath?.(sessionPath)
        ),
        readSessionBranchForPath: (sessionPath, options) => (
          this._cb?.getEngine?.()?.getSessionBranchProjection?.(sessionPath, options)
        ),
        envChangeLedger: this._cb?.getEngine?.()?.getEnvChangeLedger?.() || null,
        onCompiled: () => {
          // _systemPrompt 是非 session 路径（巡检/cron/频道/DM/bridge owner 新建）
          // 共享的 cache，必须按 master 构建，不被 per-session 开关污染。
          this._systemPrompt = this.buildSystemPrompt({ forceMemoryEnabled: this._memoryMasterEnabled });
          moduleLog.log(`${this.agentName} 记忆编译完成，system prompt 已刷新`);
        },
        agentId: this.id,
        agentDir: this.agentDir,
        sessionDir: this.sessionDir,
        memoryDir: path.dirname(this.memoryMdPath),
        memoryMdPath: this.memoryMdPath,
        todayMdPath: this.todayMdPath,
        weekMdPath: this.weekMdPath,
        longtermMdPath: this.longtermMdPath,
        factsMdPath: this.factsMdPath,
      });
      log(`  [agent] 4. memoryTicker 创建完成`);

      // 6. 启动定时调度。首次维护交给 AgentManager 的后台队列，
      // 避免 agent runtime 初始化时直接抢前台 CPU。
      this._memoryTicker.start();
    } else {
      moduleLog.warn(`⚠ 未配置 utility 模型，记忆系统暂不可用（用户可在设置中配置后重启）`);
    }

    // 7. 创建工具（记忆 + 通用）
    log(`  [agent] 7. 创建工具...`);
    this._memorySearchTool = createMemorySearchTool(this._factStore);
    this._webSearchTool = createWebSearchTool({
      configPath: this.configPath,
      searchConfigResolver: this._searchConfigResolver,
    });
    this._webFetchTool = createWebFetchTool();
    this._todoTool = createTodoTool();
    this._pinnedMemoryTools = createPinnedMemoryTools(this.agentDir);
    this._experienceTools = createExperienceTools(this.agentDir, {
      isEnabled: () => this._experienceEnabled === true,
    });

    // 8. Desk 系统（与 memory 完全独立）
    log(`  [agent] 8. Desk 系统...`);
    this._deskManager = createDeskManager(this.deskDir);
    this._deskManager.ensureDir();
    this._cronStore = this._cb?.getStudioCronStore?.() || new CronStore(
      path.join(this.deskDir, "cron-jobs.json"),
      path.join(this.deskDir, "cron-runs"),
    );
    this._automationTool = createAutomationTool(this._cronStore, {
      getAutoApprove: () => false,
      confirmStore: this._cb?.getConfirmStore?.(),
      getConfirmStore: () => this._cb?.getConfirmStore?.(),
      getAutomationSuggestionStore: () => this._cb?.getAutomationSuggestionStore?.(),
      emitEvent: (event, sp) => { if (sp) this._cb?.emitEvent?.(event, sp); },
      getSessionPath: () => this._cb?.getCurrentSessionPath?.(),
      getAgentId: () => this.id,
      getSessionCwd: (sp) => this._cb?.getSessionCwd?.(sp),
      getSessionWorkspaceFolders: (sp) => this._cb?.getSessionWorkspaceFolders?.(sp) || [],
      getSessionAuthorizedFolders: (sp) => this._cb?.getSessionAuthorizedFolders?.(sp) || [],
      getHomeCwd: (agentId) => this._cb?.getHomeCwd?.(agentId),
    });
    const resolveActiveSessionFile = (fileId, options: any = {}) => {
      const engine = this._cb?.getEngine?.();
      return engine?.resolveActiveSessionFile?.({
        fileId,
        sessionId: options?.sessionId || null,
        sessionPath: options?.sessionPath || null,
      }) || null;
    };
    this._stageFilesTool = createStageFilesTool({
      registerSessionFile: (entry) => this._cb?.registerSessionFile?.(entry),
      resolveSessionFile: resolveActiveSessionFile,
      getSessionPath: () => this._cb?.getCurrentSessionPath?.(),
    });
    this._fileTool = createFileTool({
      getCwd: () => this._cb?.getCwd?.() || this.agentDir,
      getSessionPath: () => this._cb?.getCurrentSessionPath?.(),
      getAuthorizedFolders: (sessionPath) => {
        const effectiveSessionPath = sessionPath || this._cb?.getCurrentSessionPath?.();
        return this._cb?.getEngine?.()?.getSessionAuthorizedFolders?.(effectiveSessionPath) || [];
      },
      resolveSessionFile: resolveActiveSessionFile,
      registerSessionFile: (entry) => this._cb?.registerSessionFile?.(entry),
    });
    this._browserTool = createBrowserTool(() => this._cb?.getCurrentSessionPath?.(), {
      getSessionModel: (sessionPath) => {
        const engine = this._cb?.getEngine?.();
        return engine?.getSessionByPath?.(sessionPath)?.model || null;
      },
      getVisionBridge: () => this._cb?.getEngine?.()?.getVisionBridge?.() || null,
      isVisionAuxiliaryEnabled: () => this._cb?.getEngine?.()?.isVisionAuxiliaryEnabled?.() === true,
      getJarvisHome: () => this._cb?.getEngine?.()?.jarvisHome,
      getSessionIdForPath: (sessionPath) => this._cb?.getEngine?.()?.getSessionIdForPath?.(sessionPath) || null,
      registerSessionFile: (entry) => this._cb?.registerSessionFile?.(entry),
    });
    this._notifyTool = createNotifyTool({
      onNotify: (payload, context) => this._notifyHandler?.(payload, context),
    });
    this._stopTaskTool = createStopTaskTool({
      getTaskRegistry: () => this._cb?.getTaskRegistry?.(),
      getSessionIdForPath: (sessionPath) => this._cb?.getEngine?.()?.getSessionIdForPath?.(sessionPath) || null,
    });

    this._checkDeferredTool = createCheckDeferredTool({
      getDeferredStore: () => this._cb?.getDeferredResults?.(),
      getSessionPath: () => this._cb?.getCurrentSessionPath?.(),
    });
    this._loopControlTool = createLoopControlTool({
      getLoopController: () => this._cb?.getLoopController?.(),
    });
    this._currentStatusTool = createCurrentStatusTool({
      getTimezone: () => this._cb?.getTimezone?.() || "",
      getAgent: () => this,
      getVisionBridge: () => this._cb?.getEngine?.()?.getVisionBridge?.() || null,
      getSessionModel: (sessionPath) => this._cb?.getEngine?.()?.getSessionByPath?.(sessionPath)?.model || null,
      getCurrentModel: () => this._cb?.getEngine?.()?.currentModel || null,
      getUiContext: (sessionPath) => this._cb?.getEngine?.()?.getUiContext?.(sessionPath) || null,
      listSessionFiles: (sessionPath) => this._cb?.getEngine?.()?.listActiveSessionFiles?.(sessionPath) || [],
      getSessionFolderScope: (sessionPath) => this._cb?.getEngine?.()?.getSessionFolderScope?.(sessionPath) || null,
      getBridgeContext: (sessionPath) => this._cb?.getEngine?.()?.getBridgeContextForSessionPath?.(sessionPath, { agentId: this.id }) || null,
      listOpenSubagentThreads: (sessionPath) => this._cb?.getSubagentThreadStore?.()?.listOpenDirectBySession?.(sessionPath) || [],
    });
    // 10. 设置修改工具
    this._updateSettingsTool = createUpdateSettingsTool({
      getEngine: () => this._cb?.getEngine?.(),
      getAgent: () => this,
      getConfirmStore: () => this._cb?.getConfirmStore?.(),
      getSessionPath: () => this._cb?.getCurrentSessionPath?.(),
      emitEvent: (event, sp) => { if (sp) this._cb?.emitEvent?.(event, sp); },
    });
    this._sessionFoldersTool = createSessionFoldersTool({
      getEngine: () => this._cb?.getEngine?.(),
      getConfirmStore: () => this._cb?.getConfirmStore?.(),
      getApprovalGateway: () => this._cb?.getApprovalGateway?.(),
      getSessionPath: () => this._cb?.getCurrentSessionPath?.(),
      emitEvent: (event, sp) => { if (sp) this._cb?.emitEvent?.(event, sp); },
    });

    // 9. 频道工具（需要 channelsDir 和 agentsDir）
    if (this.channelsDir && this.agentsDir) {
      const agentId = this.id;
      // 花名册来自构造期装配的 active-agent provider（见 constructor），
      // 这里只取引用传给各工具，不在 Agent 内部扫盘。
      const listAgents = this._listAgents;

      this._channelTool = createChannelTool({
        channelsDir: this.channelsDir,
        agentsDir: this.agentsDir,
        agentId,
        listAgents,
        isEnabled: () => this._cb?.isChannelsEnabled?.() ?? false,
        createChannelEntry: (input) => this._cb?.createChannelEntry?.(input),
        onPost: (channelName, senderId, message) => {
          this._channelPostHandler?.(channelName, senderId, message);
        },
      });

    }

    // 10. install_skill 工具（需要 agentDir + config + engine.resolveUtilityConfig）
    this._installSkillTool = createInstallSkillTool({
      agentDir: this.agentDir,
      getUserSkillsDir: () => this._cb?.getSkillsDir?.(),
      getConfig: () => {
        const cfg = { ...this._config };
        // learn_skills 从全局 preferences 注入（覆盖 agent config 中的值）
        const globalLearn = this._cb?.getLearnSkills?.() || {};
        if (!cfg.capabilities) cfg.capabilities = {};
        cfg.capabilities = { ...cfg.capabilities, learn_skills: globalLearn };
        return cfg;
      },
      resolveUtilityConfig: (options) => this._cb?.resolveUtilityConfigFresh?.(options),
      onInstalled: async (skillName) => {
        await this._onInstallCallback?.(skillName);
      },
      registerSessionFile: (entry) => this._cb?.registerSessionFile?.(entry),
      resolveSessionFile: resolveActiveSessionFile,
    });

    // 11. subagent 工具
    const subagentToolDeps = {
      executeIsolated: (prompt, opts) => {
        if (!this._cb?.executeIsolated) throw new Error("subagent 调用失败：engine 未初始化");
        return this._cb.executeIsolated(prompt, opts);
      },
      resolveUtilityModel: () => this._cb?.getCurrentModelId?.() || null,
      getDeferredStore: () => this._cb?.getDeferredResults?.(),
      getSubagentRunStore: () => this._cb?.getSubagentRunStore?.(),
      getSubagentThreadStore: () => this._cb?.getSubagentThreadStore?.(),
      getActivityHub: () => this._cb?.getActivityHub?.(),
      getTaskRegistry: () => this._cb?.getTaskRegistry?.(),
      setSubagentController: (id, ctrl) => this._cb?.setSubagentController?.(id, ctrl),
      removeSubagentController: (id) => this._cb?.removeSubagentController?.(id),
      getSessionPath: () => this._cb?.getCurrentSessionPath?.(),
      getSessionIdForPath: (sp) => this._cb?.getEngine?.()?.getSessionIdForPath?.(sp) || null,
      // 父会话当前权限档：subagent 省略 access 参数时据此继承（Codex 式）。
      // 按显式 sessionPath 反查，不从焦点指针推导（状态归属唯一确定）。
      getSessionPermissionMode: (sp) => this._cb?.getSessionPermissionMode?.(sp) ?? null,
      // Subagent 继承 parent session 的 cwd（不是 agent 的 home_folder）：
      // 用户在主 session 里可能把 cwd 切到某个子项目，派出 subagent 时应当在同一处干活。
      getParentCwd: () => this._cb?.getCwd?.() || null,
      listAgents: this._listAgents || null,
      currentAgentId: this.channelsDir && this.agentsDir ? this.id : undefined,
      agentDir: this.agentDir,
      emitEvent: (event, sp) => this._cb?.emitEvent?.(event, sp),
      persistSubagentSessionMeta: (sessionPath, meta) => (
        this._cb?.getEngine?.()?.setSessionExecutorMetadata?.(
          sessionPath,
          meta,
          { source: "subagent_runtime" },
        )
      ),
      proactiveDelegation: getResolvedExperimentValue(
        this._cb?.getPreferences?.(),
        PROACTIVE_SUBAGENT_EXPERIMENT_ID,
      ),
    };
    this._subagentTool = createSubagentTool(subagentToolDeps);
    this._subagentReplyTool = createSubagentReplyTool(subagentToolDeps);
    this._subagentCloseTool = createSubagentCloseTool(subagentToolDeps);

    // 13. workflow 工具（per-agent 工具开关，默认关；纳入与否由 tools.disabled 决定）
    this._workflowTool = createWorkflowTool({
      executeIsolated: (prompt, opts) => {
        if (!this._cb?.executeIsolated) throw new Error("workflow 调用失败：engine 未初始化");
        return this._cb.executeIsolated(prompt, opts);
      },
      getSessionPath: () => this._cb?.getCurrentSessionPath?.(),
      getSessionPermissionMode: (sp) => this._cb?.getSessionPermissionMode?.(sp) ?? null,
      // 节点 writeFolders 的 attenuation 上界：父 session 的 folder scope。
      getSessionFolderScope: (sp) => this._cb?.getEngine?.()?.getSessionFolderScope?.(sp) || null,
      getParentCwd: () => this._cb?.getCwd?.() || null,
      getAgentId: () => this.id,
      emitEvent: (event, sp) => this._cb?.emitEvent?.(event, sp),
      resolveAgentId: (agentType) => {
        const all = this._listAgents ? this._listAgents() : [];
        const hit = all.find((a) => a.id === agentType || a.name === agentType);
        return hit?.id;
      },
      // workflow 后台任务化：复用 subagent 的 deferred 基础设施，
      // 完成后由 DeferredResultCoordinator 回灌主对话。
      getDeferredStore: () => this._cb?.getDeferredResults?.(),
      getSubagentRunStore: () => this._cb?.getSubagentRunStore?.(),
      getSubagentThreadStore: () => this._cb?.getSubagentThreadStore?.(),
      getActivityHub: () => this._cb?.getActivityHub?.(),
      // 节点 token：从 UsageLedger 按子节点 session 汇总（usage 已在 executeIsolated 采集）。
      getUsageLedger: () => this._cb?.getEngine?.()?.usageLedger,
      // journal 断点续跑：存储在 agent 数据目录下。
      getJournalDir: () => path.join(this.agentDir, "workflow-journals"),
      // workflow node session 是审计证据，不能落到 executeIsolated 默认 .ephemeral 后被删掉。
      getWorkflowSessionDir: () => path.join(this.agentDir, "workflow-sessions"),
    });

    // 14. Interactive Card 工具（设计手册 + 渲染工具）
    this._cardGuideTool = createCardGuideTool();
    this._showCardTool = createShowCardTool();

    // 15. session 工具（跨 session 协作：list/read/send/create）。desktop-only，
    // 见 getToolsSnapshot 的 surface 裁剪；subagent 上下文由 SUBAGENT_BLOCKED_TOOLS 拦截。
    this._sessionTool = createSessionTool({
      getEngine: () => this._cb?.getEngine?.() || null,
      getDraftStore: () => this._cb?.getEngine?.()?.sessionCollabDraftStore || null,
      listAgents: this._listAgents || null,
      agentId: this.id,
      getAgentName: () => this.agentName || this.id,
    });

    // 12. 组装 system prompt（按 master 构建，与 per-session 开关解耦）
    log(`  [agent] 9. buildSystemPrompt...`);
    this._systemPrompt = this.buildSystemPrompt({ forceMemoryEnabled: this._memoryMasterEnabled });
    this._runtimeInitialized = true;
    this._refreshAppearanceSummaryInBackground();
    if (this._memoryTicker) {
      this._cb?.scheduleMemoryMaintenance?.(this.id, "runtime-init");
    }
    log(`  [agent] init 全部完成`);
  }

  /**
   * 优雅关闭：停止记忆调度，等待 tick 完成后关闭 DB
   */
  async dispose() {
    await this._memoryTicker?.stop();
    this._factStore?.close();
    this._runtimeInitialized = false;
  }

  /**
   * 非阻塞关闭：立即停止定时器，后台等 tick 完成后关闭 DB
   * 用于跨 agent 切换时不阻塞 UI（各 agent 的 DB 独立，不冲突）
   */
  disposeInBackground() {
    this._disposing = true;
    const ticker = this._memoryTicker;
    const factStore = this._factStore;

    const cleanup = () => {
      this._memoryTicker = null;
      this._factStore = null;
      this._runtimeInitialized = false;
      this._disposing = false;
      factStore?.close();
    };

    if (ticker) {
      ticker.stop().then(cleanup).catch(cleanup);
    } else {
      cleanup();
    }
  }

  // ════════════════════════════
  //  外部回调 setter（统一入口，禁止外部直接赋值 _xxx）
  // ════════════════════════════

  setCallbacks(cb) { this._cb = cb; }
  setGetOwnerIds(fn) { this._getOwnerIds = fn; }
  setOnInstallCallback(fn) { this._onInstallCallback = fn; }
  setNotifyHandler(fn) { this._notifyHandler = fn; }
  setDescriptionRefreshHandler(fn) { this._descriptionRefreshHandler = fn; }
  setDmSentHandler(fn) { this._dmSentHandler = fn; }
  setChannelPostHandler(fn) { this._channelPostHandler = fn; }
  setUtilityModel(val) { this._utilityModel = val; }
  setMemoryModel(val) { this._memoryModel = val; }

  /**
   * 为某个会话面创建带作用域的 search_memory 实例（同一 FactStore，不复制数据归属）。
   * 频道 phone 会话用它替换默认实例：默认排除其它频道的事实，跨频道需显式参数（#1670）。
   * FactStore 未初始化（记忆未启用 / runtime 未就绪）时返回 null，调用方不得注入兜底实例。
   */
  createConversationScopedMemorySearchTool(conversationScope) {
    if (!this._factStore) return null;
    return createMemorySearchTool(this._factStore, { conversationScope });
  }

  // ════════════════════════════
  //  状态访问
  // ════════════════════════════

  get config() { return this._config; }
  get factStore() { return this._factStore; }
  /**
   * 按 master 开关构建的 system prompt 缓存。
   * 用于"非 session"路径（巡检/cron/频道/DM/bridge owner 新建快照），
   * 不受任何 per-session 开关影响。Per-session 路径必须自己调
   * `buildSystemPrompt({ forceMemoryEnabled: <session 自己的状态> })` 构建快照。
   */
  get systemPrompt() { return this._systemPrompt; }
  /** 当前已 sync 进 agent 的 enabled skills（由 SkillManager.syncAgentSkills 注入） */
  get enabledSkills() { return this._enabledSkills; }
  /** 综合记忆状态：master && session 都开启才为 true */
  get memoryEnabled() { return this._memoryMasterEnabled && this._memorySessionEnabled; }
  /** agent 级别总开关 */
  get memoryMasterEnabled() { return this._memoryMasterEnabled; }
  /** agent 级别经验能力开关，缺省关闭 */
  get experienceEnabled() { return this._experienceEnabled === true; }
  /** per-session 级别（持久化、API 返回用，不受 master 影响） */
  get sessionMemoryEnabled() { return this._memorySessionEnabled; }
  get yuanPrompt() { return this._readYuan(); }
  get publicIshiki() { return this._readPublicIshiki(); }
  get utilityModel() { return this._utilityModel; }
  get memoryModel() { return this._memoryModel; }
  get runtimeInitialized() { return this._runtimeInitialized; }
  get needsRepair() { return !!this._repairState; }
  get repairState() { return this._repairState ? { ...this._repairState } : null; }
  _getAppearanceEngine(): AgentAppearanceEngine | null {
    return this._cb?.getEngine?.() || null;
  }

  _resolveAppearanceVisionConfig(engine: AgentAppearanceEngine | null = this._getAppearanceEngine()) {
    try {
      return engine?.resolveVisionConfig?.() || null;
    } catch {
      return null;
    }
  }

  _canInjectAppearancePrompt(targetModel: AgentAppearanceModel | null = null) {
    const engine = this._getAppearanceEngine();
    return hasAgentAppearanceSummaryCapability({
      visionConfig: this._resolveAppearanceVisionConfig(engine),
      targetModel: targetModel || engine?.currentModel || null,
    });
  }

  async refreshAppearanceSummary(options: RefreshAppearanceSummaryOptions = {}) {
    const engine = this._getAppearanceEngine();
    const freshVisionConfig = await engine?.resolveVisionConfigFresh?.() || null;
    const summary = await refreshAgentAppearanceProfileResource({
      agentDir: this.agentDir,
      agentName: this.agentName,
      visionConfig: freshVisionConfig,
      targetModel: options.targetModel || null,
      resolveModelWithCredentialsFresh: (modelRef) => engine?.resolveModelWithCredentialsFresh?.(modelRef) || Promise.resolve(null),
      callText: (callOptions) => callText(callOptions as unknown as Parameters<typeof callText>[0]),
      usageLedger: engine?.usageLedger,
      signal: options.signal,
    });
    if (summary && options.rebuildSystemPrompt !== false) {
      this._systemPrompt = this.buildSystemPrompt({ forceMemoryEnabled: this._memoryMasterEnabled });
    }
    return summary;
  }

  _refreshAppearanceSummaryInBackground() {
    if (!this._cb?.getEngine?.()) return;
    void this.refreshAppearanceSummary({ rebuildSystemPrompt: true }).catch((err) => {
      moduleLog.warn(`Agent appearance summary refresh failed: ${err?.message || err}`);
    });
  }

  /**
   * 当前记忆模型凭证（现场 resolve，不缓存）
   * 用户改完 provider key/url/api 后这里立即反映最新值
   */
  get resolvedMemoryModel() {
    if (!this._memoryModel || !this._resolveModel) return null;
    try {
      return this._resolveModel(this._memoryModel, this._config);
    } catch {
      return null;
    }
  }
  /** 记忆模型不可用的原因（null 表示可用，现场 resolve） */
  get memoryModelUnavailableReason() {
    if (!this._memoryModel) return "utility_large 未配置且无聊天模型可 fallback";
    if (!this._resolveModel) return null;
    try {
      this._resolveModel(this._memoryModel, this._config);
      return null;
    } catch (err) {
      return err.message;
    }
  }
  get summaryManager() { return this._summaryManager; }
  get memoryTicker() { return this._memoryTicker; }
  getToolsSnapshot(options: any = {}) {
    const surface = options.surface === "bridge" ? "bridge" : "desktop";
    const forceMemoryEnabled = Object.prototype.hasOwnProperty.call(options, "forceMemoryEnabled")
      ? options.forceMemoryEnabled
      : null;
    const forceExperienceEnabled = Object.prototype.hasOwnProperty.call(options, "forceExperienceEnabled")
      ? options.forceExperienceEnabled
      : null;
    const memoryEnabled = typeof forceMemoryEnabled === "boolean"
      ? forceMemoryEnabled
      : this.memoryEnabled;
    const experienceEnabled = typeof forceExperienceEnabled === "boolean"
      ? forceExperienceEnabled
      : this.experienceEnabled;
    const memTools = memoryEnabled ? [
      this._memorySearchTool,
      ...this._pinnedMemoryTools,
    ] : [];
    const experienceTools = experienceEnabled ? this._experienceTools : [];
    const computerUseTools = this._isComputerUseCandidateForThisAgent()
      ? [this._getComputerUseTool()]
      : [];
    const channelTools = (this._cb?.isChannelsEnabled?.() ?? false)
      ? [this._channelTool]
      : [];
    const learnCfg = this._cb?.getLearnSkills?.() || this._config?.capabilities?.learn_skills || {};
    const installSkillTools = learnCfg.enabled === true
      ? [this._installSkillTool]
      : [];
    return [
      ...memTools,
      ...experienceTools,
      this._webSearchTool,
      this._webFetchTool,
      this._todoTool,
      this._automationTool,
      this._stageFilesTool,
      this._fileTool,
      ...channelTools,
      this._browserTool,
      ...computerUseTools,
      ...installSkillTools,
      this._notifyTool,
      this._stopTaskTool,
      this._updateSettingsTool,
      this._sessionFoldersTool,
      this._subagentTool,
      this._subagentReplyTool,
      this._subagentCloseTool,
      this._workflowTool,
      this._checkDeferredTool,
      this._loopControlTool,
      this._currentStatusTool,
      ...(surface === "desktop" ? [this._sessionTool] : []),
      this._cardGuideTool,
      this._showCardTool,
    ].filter(Boolean);
  }
  get tools() {
    return this.getToolsSnapshot();
  }

  _getComputerUseTool() {
    if (!this._computerUseTool) {
      this._computerUseTool = createComputerUseTool({
        getComputerHost: () => this._cb?.getEngine?.()?.getComputerHost?.() || null,
        getSessionModel: (sessionPath) => {
          const engine = this._cb?.getEngine?.();
          return engine?.getSessionByPath?.(sessionPath)?.model || null;
        },
        getAgentId: () => this.id,
        getConfirmStore: () => this._cb?.getConfirmStore?.(),
        getApprovalGateway: () => this._cb?.getApprovalGateway?.(),
        getPermissionMode: (sessionPath) => this._cb?.getSessionPermissionMode?.(sessionPath),
        approveComputerUseApp: (approval) => this._cb?.getEngine?.()?.approveComputerUseApp?.(approval),
        emitEvent: (event, sp) => { if (sp) this._cb?.emitEvent?.(event, sp); },
        isAgentToolEnabled: () => this._isComputerUseAvailableForThisAgent(),
        isEnabledForAgentConfig: () => this._isComputerUseAvailableForThisAgent(),
      });
    }
    return this._computerUseTool;
  }

  _isComputerUseCandidateForThisAgent() {
    const engine = this._cb?.getEngine?.();
    if (engine?.isComputerUseSupported?.() === false) return false;
    const primaryAgentId = engine?.getPrimaryAgentId?.() || null;
    return !primaryAgentId || primaryAgentId === this.id;
  }

  _isComputerUseAvailableForThisAgent() {
    if (!this._isComputerUseCandidateForThisAgent()) return false;
    const engine = this._cb?.getEngine?.();
    const settings = engine?.getComputerUseSettings?.();
    return settings?.enabled === true;
  }

  // Desk 系统访问
  get deskManager() { return this._deskManager; }
  get cronStore() { return this._cronStore; }

  // ════════════════════════════
  //  记忆开关
  // ════════════════════════════

  /**
   * 设置 per-session 记忆开关（持久化由 engine 负责）。
   *
   * 不重建 `_systemPrompt`：per-session 开关只管该 session 自己的对话窗口，
   * 不应该污染所有非 session 路径共享的全局 prompt 缓存。Session 创建时
   * 会自己用 `buildSystemPrompt({ forceMemoryEnabled })` 单独构建快照。
   */
  setMemoryEnabled(val) {
    this._memorySessionEnabled = !!val;
  }

  /** 查询指定 session 的持久化记忆开关，缺省视为开启 */
  isSessionMemoryEnabledFor(sessionPath) {
    if (!sessionPath) return this._memorySessionEnabled;
    const engine = this._cb?.getEngine?.();
    if (typeof engine?.getSessionMemoryEnabled === "function") {
      return engine.getSessionMemoryEnabled(sessionPath) !== false;
    }
    return this._memorySessionEnabled;
  }

  /** 设置 agent 级别记忆总开关（同时重载 config 以获取 disabledSince/reenableAt） */
  setMemoryMasterEnabled(val) {
    this._memoryMasterEnabled = !!val;
    this._config = loadConfig(this.configPath);
    this._systemPrompt = this.buildSystemPrompt({ forceMemoryEnabled: this._memoryMasterEnabled });
  }

  /** 设置当前启用的 skill 列表（由 engine._syncAgentSkills 调用） */
  setEnabledSkills(skills) {
    this._enabledSkills = skills || [];
    this._systemPrompt = this.buildSystemPrompt({ forceMemoryEnabled: this._memoryMasterEnabled });
  }

  // ════════════════════════════
  //  配置更新
  // ════════════════════════════

  /**
   * 更新配置（写入 config.yaml 并刷新受影响的模块）
   * @param {object} partial - 要合并的配置片段
   */
  updateConfig(partial, options: any = {}) {
    assertAgentConfigPatchYuan(this.productDir, partial);
    // 写入磁盘 + 重新加载
    saveConfig(this.configPath, partial);
    this._config = loadConfig(this.configPath);
    this._refreshRepairState();
    if (this._repairState) {
      throw new Error(`Agent config needs repair: ${this._repairState.message}`);
    }

    // 更新身份。用户的名字不在这里刷新：它只存在于全局 preferences，写它走
    // 全局那条路，agent config 的改动影响不到它。
    if (partial.agent?.name) this.agentName = this._config.agent?.name || "Jarvis";

    // yuan 切换只需更新 config，buildSystemPrompt 会实时读模板
    if (partial.agent?.yuan) {
      moduleLog.log(`yuan type switched to: ${partial.agent.yuan}`);
    }

    // 记忆总开关
    if (partial.memory && "enabled" in partial.memory) {
      this._memoryMasterEnabled = this._config.memory?.enabled !== false;
    }
    if (partial.experience && "enabled" in partial.experience) {
      this._experienceEnabled = this._config.experience?.enabled === true;
    }

    // 刷新受影响的模块
    if (partial.search) {
      this._webSearchTool = createWebSearchTool({
        configPath: this.configPath,
        searchConfigResolver: this._searchConfigResolver,
      });
    }

    // 重建 system prompt（按 master 构建，与 per-session 开关解耦）
    this._systemPrompt = this.buildSystemPrompt({ forceMemoryEnabled: this._memoryMasterEnabled });

    // identity / ishiki 文件变化由调用方显式传入 refreshDescription；yuan 变化来自 config patch。
    if (options.refreshDescription || partial.agent?.yuan) {
      this._descriptionRefreshHandler?.();
    }
  }

  _refreshRepairState() {
    this._repairState = getAgentConfigRepairState(this._config, this.productDir);
  }

  // ════════════════════════════
  //  System Prompt 组装
  // ════════════════════════════

  /**
   * 读取 identity.md 的实际生效内容：agentDir 落盘文件（用户定制）优先，
   * 缺失时按当前 yuan + locale 回落到 lib 模板。identity.md 不再在创建
   * agent 时播种落盘，这是唯一的解析入口——personality getter、
   * descriptionSource getter、以及 server 路由都必须消费它，不许各自复制
   * 回落顺序。
   */
  readIdentitySource() {
    return resolvePersonaSource({
      agentDir: this.agentDir,
      productDir: this.productDir,
      yuanType: this._config?.agent?.yuan || "jarvis",
      locale: this.resolveLocale(),
      kind: "identity",
    });
  }

  /** 读取 ishiki.md 的实际生效内容，回落规则同 readIdentitySource()。 */
  readIshikiSource() {
    return resolvePersonaSource({
      agentDir: this.agentDir,
      productDir: this.productDir,
      yuanType: this._config?.agent?.yuan || "jarvis",
      locale: this.resolveLocale(),
      kind: "ishiki",
    });
  }

  /** 返回纯人格 prompt（identity + yuan + ishiki），不含记忆、用户档案等 */
  get personality() {
    const fill = (text) => text
      .replace(/\{\{userName\}\}/g, this.userName)
      .replace(/\{\{agentName\}\}/g, this.agentName)
      .replace(/\{\{agentId\}\}/g, this.id);
    const identityMd = this.readIdentitySource().content;
    const yuanMd = this._readYuan();
    const ishikiMd = this.readIshikiSource().content;
    return fill(identityMd) + "\n\n" + fill(yuanMd || "") + "\n\n" + fill(ishikiMd);
  }

  /** 返回花名册描述生成用的人格来源，不包含 yuan 输出协议。 */
  get descriptionSource() {
    const fill = (text) => text
      .replace(/\{\{userName\}\}/g, this.userName)
      .replace(/\{\{agentName\}\}/g, this.agentName)
      .replace(/\{\{agentId\}\}/g, this.id);
    const identityMd = this.readIdentitySource().content;
    const ishikiMd = this.readIshikiSource().content;
    return fill(identityMd) + "\n\n" + fill(ishikiMd);
  }

  /** 读取 yuan 模板（能力定义） */
  _readYuan() {
    const yuanType = this._config?.agent?.yuan || "jarvis";
    const templatePath = resolveTemplatePath(
      path.join(this.productDir, "yuan"),
      `${yuanType}.md`,
      this._promptLang(),
      (candidate) => fs.existsSync(candidate),
    );
    return templatePath ? safeReadFile(templatePath, "") : "";
  }

  /** 读取对外意识（public-ishiki.md），guest 会话使用 */
  _readPublicIshiki() {
    const readFile = (p) => safeReadFile(p, "");
    const fill = (text) => text
      .replace(/\{\{userName\}\}/g, this.userName)
      .replace(/\{\{agentName\}\}/g, this.agentName)
      .replace(/\{\{agentId\}\}/g, this.id);
    const yuanType = this._config?.agent?.yuan || "jarvis";
    const templatePath = resolveTemplatePath(
      path.join(this.productDir, "public-ishiki-templates"),
      `${yuanType}.md`,
      this._promptLang(),
      (candidate) => fs.existsSync(candidate),
    );
    const raw = readFile(path.join(this.agentDir, "public-ishiki.md"))
      || (templatePath ? readFile(templatePath) : "")
      || "";
    return fill(raw);
  }

  _formatTeamRoster(lang: PromptLang, options: any = {}) {
    const includeSelf = options.includeSelf !== false;
    if (!this._listAgents) return "";
    const allAgents = this._listAgents();
    const others = allAgents.filter(a => a.id !== this.id);
    if (others.length === 0) return "";
    const rosterAgents = includeSelf ? allAgents : others;
    return rosterAgents.map(a => {
      const tag = a.id === this.id ? getAgentPromptPack(lang).rosterSelfTag : "";
      const model = a.model ? ` [${a.model}]` : "";
      const desc = a.summary ? ` — ${a.summary}` : "";
      const nameLabel = a.name && a.name !== a.id ? `（${a.name}）` : "";
      return `- \`${a.id}\`${nameLabel}${tag}${model}${desc}`;
    }).join("\n");
  }

  buildMemoryReflectionSnapshot(options: any = {}) {
    const forceMemoryEnabled = Object.prototype.hasOwnProperty.call(options, "forceMemoryEnabled")
      ? options.forceMemoryEnabled
      : null;
    const memoryEnabled = typeof forceMemoryEnabled === "boolean"
      ? forceMemoryEnabled
      : this.memoryEnabled;
    const lang = this._promptLang();
    const pack = getAgentPromptPack(lang);
    const readFile = (filePath) => safeReadFile(filePath, "");

    const pinnedMd = readFile(path.join(this.agentDir, "pinned.md")).trim();
    const memoryMd = readFile(this.memoryMdPath).trim();
    const hasMemory = memoryMd && memoryMd !== "（暂无记忆）" && memoryMd !== "(No memory yet)";
    const existingMemory = memoryEnabled
      ? [
        pinnedMd
          ? `${pack.reflectionPinnedHeading}\n\n${pinnedMd}`
          : "",
        hasMemory
          ? `${pack.reflectionMemoryHeading}\n\n${memoryMd}`
          : "",
      ].filter(Boolean).join("\n\n")
      : "";

    return {
      version: 1,
      locale: this.resolveLocale(),
      agentId: this.id,
      agentName: this.agentName,
      userName: this.userName,
      identityAndPersonality: this.personality.trim(),
      userProfile: readFile(userProfilePath(this.userDir)).trim(),
      existingMemory,
      roster: this._formatTeamRoster(lang, { includeSelf: false }),
    };
  }

  /**
   * 组装 system prompt
   * @param {object} [options]
   * @param {boolean} [options.forSubagent] - 为 subagent 构造的轻量 prompt：
   *   跳过记忆三段（规则 + pinned.md + memory.md）和团队 agent 名单。
   *   Subagent 是隔离子会话，不注入长期记忆和多 agent 协作上下文。
   * @param {object} [options.targetModel] - 新会话即将使用的模型，用于判断是否能读取头像。
   */
  buildSystemPrompt(options: BuildSystemPromptOptions = {}) {
    const forSubagent = !!options.forSubagent;
    const forceMemoryEnabled = Object.prototype.hasOwnProperty.call(options, "forceMemoryEnabled")
      ? options.forceMemoryEnabled
      : null;
    const targetModel = Object.prototype.hasOwnProperty.call(options, "targetModel")
      ? options.targetModel
      : null;
    const memoryEnabled = typeof forceMemoryEnabled === "boolean"
      ? forceMemoryEnabled
      : this.memoryEnabled;
    const lang = this._promptLang();
    const pack = getAgentPromptPack(lang);

    const readFile = (filePath) => safeReadFile(filePath, "");

    // identity + yuan + ishiki（复用 personality getter）
    const yuanType = this._config?.agent?.yuan || "jarvis";
    if (!this._readYuan()) throw new Error(`Cannot find yuan "${yuanType}". Check lib/yuan/`);
    const ishiki = this.personality;

    // 可选文件
    const userMd = readFile(userProfilePath(this.userDir));
    const pinnedMd = readFile(path.join(this.agentDir, "pinned.md"));
    const memory = readFile(this.memoryMdPath);

    // 构建 section 分隔格式的 prompt
    const section = (title, content) => ["", "---", "", title, "", content];

    // Prompt 拼接遵循「静态前缀在前、动态尾部在后」原则，最大化跨 session 的 prefix
    // cache 命中率（KV cache / Anthropic prompt cache 都按严格前缀匹配）。
    // 顺序：平台 → 环境 → 用户档案 → ishiki（依赖 userName）→ 样貌
    //      → 行为指南（任务/经验/工具/安全/网页/设置/技能/团队）
    //      ── cache 分界线 ──
    //      记忆规则/置顶/记忆 → 会话开始时间
    //
    // 用户档案和人格段放进静态前缀：userName 已统一走「显式覆盖 → 全局 preferences →
    // 语言兜底」解析，人格文件也改成惰性物化，这两段只在用户自己改档案或换人格时才变，
    // 属于事件驱动的稳定段，放在尾部只会白白撑大动态区。记忆会被后台 compile 推动、
    // 时间每次构建都在走，这两段才是真正的自动漂移源，继续留在 cache 分界线之后。
    //
    // ishiki 放在用户档案之后：模板里有「你和{userName}是认识很久的人」这类引用，
    // 叙事顺序上先告诉模型"用户是谁"，再告诉它"你是谁、你和用户什么关系"。
    const parts = [pack.platform];
    const platformPrompt = getPlatformPromptNote({ platform: process.platform });
    if (platformPrompt) {
      parts.push(...section(
        pack.environmentHeading,
        platformPrompt
      ));
    }

    // 用户档案（user.md）
    // 名字走 resolveUserName()：全局 preferences → 语言兜底。
    // 因为末端有兜底值，这一行现在总会出现；没配过名字时给出的是"用户"/"User"
    // 这种中性称呼，与 prompt 其它位置对用户的称呼保持一致。
    const resolvedUserName = this.resolveUserName();
    const userProfileLines = [
      pack.userProfileIntro,
      pack.userNameLine(resolvedUserName),
    ];
    if (userMd) {
      userProfileLines.push("", userMd);
    }
    parts.push(...section(
      pack.userProfileHeading,
      userProfileLines.join("\n")
    ));

    // ishiki（identity + yuan + ishiki 模板，含 {{userName}} 等替换）
    // 放在用户档案之后：先建立"用户是谁"的语境，再讲"你是谁、你和用户什么关系"。
    parts.push(ishiki);

    if (!forSubagent && this._canInjectAppearancePrompt(targetModel)) {
      const appearance = readAgentAppearanceProfileResource(this.agentDir);
      const appearancePrompt = appearance
        ? formatAgentAppearancePrompt(appearance.summary, this.resolveLocale())
        : "";
      if (appearancePrompt) parts.push(appearancePrompt);
    }

    parts.push(pack.outputConstraint);

    // 记忆整体开关：master && session 都开启才注入记忆相关 prompt
    // Subagent 场景下整块跳过（无记忆工具 = 规则和 pinned 也是孤儿噪音）
    // 注意：记忆块本身已下移到 prompt 末尾（见下方），这里只是预先准备好规则文本
    let memoryBlock = null;
    if (memoryEnabled && !forSubagent) {
      const memoryRule = pack.memoryRule(this.userName);

      // memoryRule 只注入一次，置顶和记忆 section 只放内容
      const hasPinned = pinnedMd.trim();
      const trimmedMemory = memory.trim();
      const hasMemory = trimmedMemory && trimmedMemory !== "（暂无记忆）" && trimmedMemory !== "(No memory yet)";

      if (hasPinned || hasMemory) {
        const memParts = [memoryRule];
        if (hasPinned) {
          memParts.push(...section(
            pack.pinnedMemoriesHeading,
            pack.pinnedMemoriesIntro + pinnedMd
          ));
        }
        if (hasMemory) {
          memParts.push(...section(
            pack.memoryHeading,
            pack.memoryIntro + memory
          ));
        }
        memoryBlock = memParts;
      }
    }

    // Skills 注入由 Pi SDK 内部统一处理：SDK 会在 buildSystemPrompt 的 customPrompt
    // 分支末尾追加一份 formatSkillsForPrompt(skills)。这里再追加一次会重复（#399）。
    // 显示路径（GET /system-prompt）会自行拼接 skills 以保持开发者视图一致。

    // 工具使用纪律（轻量优先；并入原「文件与命令工具使用」段的文件工具指引）
    parts.push(pack.toolDiscipline);

    parts.push(pack.sessionFiles);

    parts.push(pack.visibleUiContext);

    if (!forSubagent) {
      const proactiveDelegation = getResolvedExperimentValue(
        this._cb?.getPreferences?.(),
        PROACTIVE_SUBAGENT_EXPERIMENT_ID,
      );
      const delegation = proactiveDelegation ? pack.delegationNote : "";
      parts.push(pack.subagentSection(delegation));
    }

    if (this._isComputerUseAvailableForThisAgent()) {
      parts.push(pack.desktopAppControl);
    }

    // 行动纪律（失败诊断优先于换方案 + 操作可逆性判断框架，合并为一段）
    parts.push(pack.actionDiscipline);

    // 网页工具选择优先级（跨工具编排，工具 description 里放不下）
    parts.push(pack.webToolPriority);

    // 主动技能获取引导（仅在 allow_github_fetch 开启时注入）
    // learn_skills 从全局 preferences 读取
    const learnCfg = this._cb?.getLearnSkills?.() || this._config?.capabilities?.learn_skills || {};
    if (learnCfg.enabled && learnCfg.allow_github_fetch) {
      parts.push(pack.skillAcquisition);
    }

    // 团队协作（仅当存在其他 agent 时注入）
    // Subagent 场景下跳过：subagent 没有 subagent 工具，知道其他 agent 也使不上
    if (!forSubagent) {
      const roster = this._formatTeamRoster(lang);
      if (roster) {
        parts.push(pack.teamSection(roster));
      }
    }

    // ── cache 分界线 ──
    // 以下内容会自动漂移（后台 compile 更新记忆、时间戳每次构建都在走），
    // 统一放在 prompt 末尾以保护前面静态前缀的 cache 命中率。

    // 记忆规则 + 置顶记忆 + 记忆（动态，后台 compile 会更新；按 session 快照）
    if (memoryBlock) {
      parts.push(...memoryBlock);
    }

    // 日期时间（尊重用户时区偏好，fallback 到系统时区）
    const tz = this._cb?.getTimezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    const fmtOpts = {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZoneName: "short",
      hourCycle: "h23",
      ...(tz ? { timeZone: tz } : {}),
    };
    const dateTime = new Intl.DateTimeFormat("en-US", fmtOpts as any).format(now);
    parts.push(`\nSession started at: ${dateTime}`);
    parts.push(pack.sessionStartedNote);
    parts.push(pack.dayBoundaryNote);

    return parts.join("\n");
  }
}
