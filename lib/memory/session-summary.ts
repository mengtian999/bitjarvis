/**
 * session-summary.js — Session 摘要管理器
 *
 * 每个 session 一个 JSON 文件（存在 memory/summaries/ 下），
 * 包含摘要文本 + 深度记忆处理的 snapshot。
 *
 * 摘要通过 rollingSummary() 滚动更新（覆盖式，非追加），
 * 输出固定为 rolling-summary-format.ts 契约规定的 facts + timeline 两节格式。
 *
 * 同时服务：
 * - 普通记忆（compile.js 读摘要 → 递归压缩 → memory.md）
 * - 深度记忆（deep-memory.js 读 snapshot diff → 拆元事实）
 */

import fs from "fs";
import path from "path";
import { atomicWriteSync } from "../../shared/safe-fs.ts";
import { scrubPII } from "../pii-guard.ts";
import { callText, DEFAULT_CALL_TEXT_TIMEOUT_MS } from "../../core/llm-client.ts";
import { callTextConfigFromResolvedModel } from "../../core/model-execution-config.ts";
import { getToolArgs, isToolCallBlock } from "../../core/llm-utils.ts";
import { getLocale } from "../i18n.ts";
import { normalizePromptLang, pickPromptText, type PromptLang } from "../../shared/prompt-locale.ts";
import { readCompiledResetAt } from "./compiled-memory-state.ts";
import { attachPromptLayoutMetadata, buildUtilityPromptLayout } from "../llm/prompt-layout.ts";
import {
  buildSourceTimeRange,
  formatZonedDateTime,
  resolveMemoryTimeZone,
} from "./time-context.ts";
import { createModuleLogger } from "../debug-log.ts";
import { withMemoryReasoningBuffer } from "./llm-budget.ts";
import {
  MAX_ROLLING_SUMMARY_FORMAT_REPAIRS,
  buildRollingSummaryFormatRequirements,
  buildRollingSummaryRepairInput,
  buildRollingSummaryRepairPrompt,
  getFactSectionTitle,
  getTimelineSectionTitle,
  validateRollingSummaryFormat,
} from "./rolling-summary-format.ts";

const log = createModuleLogger("session-summary");

export function sessionSummaryRevision(data) {
  if (!data || typeof data !== "object") return null;
  return JSON.stringify({
    updatedAt: data.updated_at || null,
    summary: data.summary || "",
    snapshot: data.snapshot || "",
    cursor: data.cursor || null,
    snapshotCursor: data.snapshotCursor || null,
    factReplacementRequired: data.factReplacementRequired === true,
  });
}

export class SessionSummaryManager {
  declare summariesDir: string;
  declare _cache: Map<string, any>;
  declare _cachePopulated: boolean;

  /**
   * @param {string} summariesDir - summaries/ 目录的绝对路径
   */
  constructor(summariesDir) {
    this.summariesDir = summariesDir;
    fs.mkdirSync(summariesDir, { recursive: true });
    this._cache = new Map();          // sessionId → summary data
    this._cachePopulated = false;     // 是否已做过全量扫描
  }

  // ════════════════════════════
  //  读写
  // ════════════════════════════

  /**
   * 读取指定 session 的摘要
   * @param {string} sessionId
   * @returns {object|null}
   */
  getSummary(sessionId) {
    if (this._cache.has(sessionId)) return this._cache.get(sessionId);
    const fp = this._filePath(sessionId);
    try {
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      this._cache.set(sessionId, data);
      return data;
    } catch {
      return null;
    }
  }

  /**
   * 写入摘要（原子写入）
   * @param {string} sessionId
   * @param {object} data
   */
  saveSummary(sessionId, data) {
    const fp = this._filePath(sessionId);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    atomicWriteSync(fp, JSON.stringify(data, null, 2) + "\n");
    this._cache.set(sessionId, data);
  }

  /**
   * A fork owns an independent memory lineage. Keep the source/boundary metadata,
   * but start the child's rolling-summary cursor at zero so its first memory pass
   * can derive durable state from its own active transcript. Reusing the source
   * message count would couple the child to the source summary and also mixes count
   * domains when compiled-memory resetAt filtering is active.
   */
  initializeForkBaseline(sessionId, input: Record<string, any> = {}) {
    const normalized = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalized) throw new Error("fork memory baseline requires sessionId");
    const sourceSessionId = typeof input.sourceSessionId === "string" ? input.sourceSessionId.trim() : "";
    const throughEntryId = typeof input.throughEntryId === "string" ? input.throughEntryId.trim() : "";
    const retainedMessageCount = Number(input.retainedMessageCount ?? input.messageCount);
    if (!sourceSessionId) throw new Error("fork memory baseline requires sourceSessionId");
    if (!throughEntryId) throw new Error("fork memory baseline requires throughEntryId");
    if (!Number.isInteger(retainedMessageCount) || retainedMessageCount < 0) {
      throw new Error("fork memory baseline retainedMessageCount must be a non-negative integer");
    }
    if (this.getSummary(normalized) || fs.existsSync(this._filePath(normalized))) {
      throw new Error(`fork memory baseline already exists for ${normalized}`);
    }
    const forkedAt = normalizeSince(input.forkedAt) || new Date().toISOString();
    const data = {
      session_id: normalized,
      created_at: forkedAt,
      updated_at: forkedAt,
      summary: "",
      messageCount: 0,
      source_time_range: null,
      snapshot: "",
      snapshot_at: null,
      fork_baseline: {
        sourceSessionId,
        throughEntryId,
        retainedMessageCount,
        forkedAt,
      },
    };
    this.saveSummary(normalized, data);
    return data;
  }

  /**
   * 作废单个 session 的派生摘要。Retry 改变 active branch 后，旧摘要不能继续
   * 参与 today/facts/deep-memory 编译。文件与内存缓存必须作为一个操作清掉。
   *
   * @param {string} sessionId
   * @returns {boolean} 是否删除了持久化摘要或缓存项
   */
  invalidateSession(sessionId, opts: Record<string, any> = {}) {
    const normalized = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!normalized) throw new Error("session summary invalidation requires sessionId");
    const existing = this.getSummary(normalized);
    const retainedMessageCount = Number(opts.retainedMessageCount);
    if (
      existing?.fork_baseline
      && Number.isInteger(retainedMessageCount)
      && retainedMessageCount >= 0
    ) {
      const inheritedCount = Number(
        existing.fork_baseline.retainedMessageCount
        ?? existing.fork_baseline.messageCount,
      );
      const nextRetainedCount = Number.isInteger(inheritedCount) && inheritedCount >= 0
        ? Math.min(inheritedCount, retainedMessageCount)
        : retainedMessageCount;
      const now = new Date().toISOString();
      this.saveSummary(normalized, {
        session_id: normalized,
        created_at: existing.created_at || existing.fork_baseline.forkedAt || now,
        updated_at: now,
        summary: "",
        messageCount: 0,
        source_time_range: null,
        snapshot: "",
        snapshot_at: null,
        fork_baseline: {
          ...existing.fork_baseline,
          retainedMessageCount: nextRetainedCount,
        },
      });
      return true;
    }
    const hadCache = this._cache.delete(normalized);
    try {
      fs.unlinkSync(this._filePath(normalized));
      return true;
    } catch (err) {
      if (err?.code === "ENOENT") return hadCache;
      throw err;
    }
  }

  // ════════════════════════════
  //  脏 session 追踪（供深度记忆用）
  // ════════════════════════════

  /**
   * 获取所有"脏" session（summary !== snapshot）
   * @returns {Array<{ session_id, summary, snapshot, snapshot_at, updated_at }>}
   */
  getDirtySessions(opts: Record<string, any> = {}) {
    this._ensureCachePopulated();
    const since = normalizeSince(opts.since);
    const dirty = [];
    for (const data of this._cache.values()) {
      if (!data?.summary && data?.factReplacementRequired !== true) continue;
      if (since && !isAfter(data.updated_at || data.created_at, since)) continue;
      if (data.factReplacementRequired === true || data.summary !== (data.snapshot || "")) {
        dirty.push(data);
      }
    }
    return dirty;
  }

  /**
   * 标记 session 已被深度记忆处理（snapshot = summary）
   * @param {string} sessionId
   */
  markProcessed(sessionId) {
    const data = this.getSummary(sessionId);
    if (!data) return;

    const next = {
      ...data,
      snapshot: data.summary,
      snapshotCursor: data.cursor || null,
      snapshot_at: new Date().toISOString(),
      factReplacementRequired: false,
    };
    this.saveSummary(sessionId, next);
    return true;
  }

  isRevisionCurrent(sessionId, expectedRevision) {
    return expectedRevision != null
      && sessionSummaryRevision(this.getSummary(sessionId)) === expectedRevision;
  }

  markProcessedIfCurrent(sessionId, expectedRevision) {
    if (!this.isRevisionCurrent(sessionId, expectedRevision)) return false;
    return this.markProcessed(sessionId);
  }

  // ════════════════════════════
  //  查询
  // ════════════════════════════

  /**
   * 获取所有摘要（按 updated_at 降序）
   * @returns {Array<object>}
   */
  getAllSummaries() {
    this._ensureCachePopulated();
    const summaries = [];
    for (const data of this._cache.values()) {
      if (data?.summary) summaries.push(data);
    }
    summaries.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    return summaries;
  }

  /** 首次调用时做一次全量扫描填充缓存 */
  _ensureCachePopulated() {
    if (this._cachePopulated) return;
    const files = this._listFiles();
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (data?.session_id) this._cache.set(data.session_id, data);
      } catch {}
    }
    this._cachePopulated = true;
  }

  /**
   * 获取指定日期范围内的摘要
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Array<object>}
   */
  getSummariesInRange(startDate, endDate, opts: Record<string, any> = {}) {
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();
    const since = normalizeSince(opts.since);

    return this.getAllSummaries().filter((s) => {
      const updated = s.updated_at || s.created_at || "";
      if (updated < startISO || updated > endISO) return false;
      if (since && !isAfter(updated, since)) return false;
      return true;
    });
  }

  clearCache() {
    this._cache.clear();
    this._cachePopulated = false;
  }

  clearAll() {
    fs.mkdirSync(this.summariesDir, { recursive: true });
    for (const file of this._listFiles()) {
      try { fs.unlinkSync(file); } catch (err) {
        if (err?.code !== "ENOENT") throw err;
      }
    }
    this.clearCache();
  }

  // ════════════════════════════
  //  内部
  // ════════════════════════════

  _filePath(sessionId) {
    // session 文件名可能包含时间戳前缀（如 1234567890_uuid），
    // 直接取 uuid 部分（去掉 .jsonl 后缀和时间戳前缀）
    const cleanId = sessionId.replace(/\.jsonl$/, "");
    return path.join(this.summariesDir, `${cleanId}.json`);
  }

  _listFiles() {
    try {
      return fs.readdirSync(this.summariesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(this.summariesDir, f));
    } catch {
      return [];
    }
  }

  /**
   * 从消息列表构建带时间戳的对话文本
   * @param {Array<{role: string, content: any, timestamp?: string}>} messages
   * @returns {string}
   */
  _buildConversationText(messages, opts: Record<string, any> = {}) {
    const parts = [];
    const lang = normalizePromptLang(getLocale());
    const timeZone = resolveMemoryTimeZone(opts.timeZone);

    for (const msg of messages) {
      const segments = this._extractSummarySegments(msg, lang);
      if (segments.length === 0) continue;

      // 时间标注
      let timePrefix = "";
      if (msg.timestamp) {
        const d = new Date(msg.timestamp);
        if (!isNaN(d.getTime())) {
          timePrefix = `[${formatZonedDateTime(d, timeZone)}] `;
        }
      }

      const speaker = msg.role === "user"
        ? pickPromptText(lang, { zh: "用户", ja: "ユーザー", ko: "사용자", fr: "Utilisateur", de: "Benutzer", en: "User" })
        : pickPromptText(lang, { zh: "助手", ja: "アシスタント", ko: "어시스턴트", fr: "Assistant", de: "Assistent", en: "Assistant" });
      for (const segment of segments) {
        parts.push(`${timePrefix}【${speaker}】${segment}`);
      }
    }

    return parts.join("\n\n");
  }

  _extractSummarySegments(msg, lang: PromptLang) {
    if (!msg?.content) return [];

    if (typeof msg.content === "string") {
      const text = msg.content.trim();
      return text ? [text] : [];
    }

    if (!Array.isArray(msg.content)) return [];

    const segments = [];
    let textBuffer = "";
    const flushText = () => {
      const text = textBuffer.trim();
      if (text) segments.push(text);
      textBuffer = "";
    };

    for (const block of msg.content) {
      if (block?.type === "text" && block.text) {
        textBuffer += block.text;
        continue;
      }

      if (msg.role === "assistant" && isToolCallBlock(block)) {
        flushText();
        const title = this._summarizeToolCall(block, lang);
        if (title) segments.push(title);
      }
    }

    flushText();
    return segments;
  }

  _summarizeToolCall(block, lang: PromptLang) {
    const t = (table) => pickPromptText(lang, table);
    const name = String(block?.name || "").trim();
    if (!name) return "";
    const args = getToolArgs(block) && typeof getToolArgs(block) === "object" ? getToolArgs(block) : {};
    const pick = (...keys) => {
      for (const key of keys) {
        const value = args[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    };
    const shorten = (text, limit = 120) => {
      if (!text) return "";
      return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
    };

    switch (name) {
      case "read":
      case "read_file":
        return t({ zh: `读取了 ${pick("file_path", "path")}`, ja: `${pick("file_path", "path")} を読み取った`, ko: `${pick("file_path", "path")} 읽음`, en: `Read ${pick("file_path", "path")}` });
      case "write":
        return t({ zh: `写入了 ${pick("file_path", "path")}`, ja: `${pick("file_path", "path")} に書き込んだ`, ko: `${pick("file_path", "path")} 쓰기 완료`, en: `Wrote ${pick("file_path", "path")}` });
      case "edit":
      case "edit-diff":
        return t({ zh: `修改了 ${pick("file_path", "path")}`, ja: `${pick("file_path", "path")} を編集した`, ko: `${pick("file_path", "path")} 수정함`, en: `Edited ${pick("file_path", "path")}` });
      case "bash":
        return t({ zh: `执行了命令 ${shorten(pick("command"), 80)}`, ja: `コマンドを実行した ${shorten(pick("command"), 80)}`, ko: `명령어 실행 ${shorten(pick("command"), 80)}`, en: `Ran command ${shorten(pick("command"), 80)}` });
      case "glob":
      case "find":
        return t({ zh: `查找了 ${shorten(pick("pattern"), 80)}`, ja: `${shorten(pick("pattern"), 80)} を検索した`, ko: `${shorten(pick("pattern"), 80)} 검색함`, en: `Searched for ${shorten(pick("pattern"), 80)}` });
      case "grep": {
        const pattern = shorten(pick("pattern"), 60);
        const target = pick("path");
        return t({
          zh: `搜索了 ${pattern}${target ? `（范围 ${target}）` : ""}`,
          ja: `${pattern} を検索した${target ? `（対象 ${target}）` : ""}`,
          ko: `${pattern} 검색${target ? ` (대상 ${target})` : ""}`,
          en: `Searched ${pattern}${target ? ` in ${target}` : ""}`,
        });
      }
      case "ls":
        return t({ zh: `查看了 ${pick("path")}`, ja: `${pick("path")} を一覧表示した`, ko: `${pick("path")} 목록 조회`, en: `Listed ${pick("path")}` });
      case "web_fetch":
        return t({ zh: `读取了网页 ${pick("url")}`, ja: `Web ページを取得した ${pick("url")}`, ko: `웹페이지 가져옴 ${pick("url")}`, en: `Fetched ${pick("url")}` });
      case "web_search":
        return t({ zh: `搜索了 ${shorten(pick("query"), 80)}`, ja: `${shorten(pick("query"), 80)} を Web 検索した`, ko: `${shorten(pick("query"), 80)} 웹 검색`, en: `Searched ${shorten(pick("query"), 80)}` });
      case "browser": {
        const action = pick("action");
        const url = pick("url");
        const detail = url || action;
        return t({
          zh: `操作了浏览器${detail ? `（${detail}）` : ""}`,
          ja: `ブラウザを操作した${detail ? `（${detail}）` : ""}`,
          ko: `브라우저 조작${detail ? ` (${detail})` : ""}`,
          en: `Used browser${detail ? ` (${detail})` : ""}`,
        });
      }
      case "search_memory":
        return t({ zh: `搜索了记忆 ${shorten(pick("query"), 80)}`, ja: `記憶を検索した ${shorten(pick("query"), 80)}`, ko: `기억 검색 ${shorten(pick("query"), 80)}`, en: `Searched memory ${shorten(pick("query"), 80)}` });
      case "subagent":
        return t({
          zh: `启动了子代理${pick("task", "prompt") ? `：${shorten(pick("task", "prompt"), 80)}` : ""}`,
          ja: `サブエージェントを起動した${pick("task", "prompt") ? `：${shorten(pick("task", "prompt"), 80)}` : ""}`,
          ko: `서브에이전트 시작${pick("task", "prompt") ? `: ${shorten(pick("task", "prompt"), 80)}` : ""}`,
          en: `Started subagent${pick("task", "prompt") ? `: ${shorten(pick("task", "prompt"), 80)}` : ""}`,
        });
      case "dm":
        return t({
          zh: `发送了私信${pick("to") ? ` 给 ${pick("to")}` : ""}`,
          ja: `DM を送信した${pick("to") ? `（宛先 ${pick("to")}）` : ""}`,
          ko: `DM 전송${pick("to") ? ` (수신 ${pick("to")})` : ""}`,
          en: `Sent DM${pick("to") ? ` to ${pick("to")}` : ""}`,
        });
      case "channel":
        return t({ zh: `操作了频道 ${pick("channel", "name")}`, ja: `チャンネル ${pick("channel", "name")} を使用した`, ko: `채널 ${pick("channel", "name")} 사용`, en: `Used channel ${pick("channel", "name")}` });
      case "cron":
        return t({
          zh: `设置了定时任务${pick("label", "prompt") ? `：${shorten(pick("label", "prompt"), 80)}` : ""}`,
          ja: `定期タスクを設定した${pick("label", "prompt") ? `：${shorten(pick("label", "prompt"), 80)}` : ""}`,
          ko: `예약 작업 설정${pick("label", "prompt") ? `: ${shorten(pick("label", "prompt"), 80)}` : ""}`,
          en: `Scheduled task${pick("label", "prompt") ? `: ${shorten(pick("label", "prompt"), 80)}` : ""}`,
        });
      case "notify":
        return t({
          zh: `发送了通知${pick("title") ? `：${shorten(pick("title"), 80)}` : ""}`,
          ja: `通知を送信した${pick("title") ? `：${shorten(pick("title"), 80)}` : ""}`,
          ko: `알림 전송${pick("title") ? `: ${shorten(pick("title"), 80)}` : ""}`,
          en: `Sent notification${pick("title") ? `: ${shorten(pick("title"), 80)}` : ""}`,
        });
      case "artifact":
        return t({
          zh: `生成了产物${pick("title") ? `：${shorten(pick("title"), 80)}` : ""}`,
          ja: `成果物を生成した${pick("title") ? `：${shorten(pick("title"), 80)}` : ""}`,
          ko: `산출물 생성${pick("title") ? `: ${shorten(pick("title"), 80)}` : ""}`,
          en: `Generated artifact${pick("title") ? `: ${shorten(pick("title"), 80)}` : ""}`,
        });
      case "install_skill":
        return t({
          zh: `安装了技能 ${pick("skill_name", "github_url", "local_path", "fileId")}`,
          ja: `スキルをインストールした ${pick("skill_name", "github_url", "local_path", "fileId")}`,
          ko: `스킬 설치 ${pick("skill_name", "github_url", "local_path", "fileId")}`,
          en: `Installed skill ${pick("skill_name", "github_url", "local_path", "fileId")}`,
        });
      case "update_settings":
        return t({ zh: `修改了设置 ${pick("key", "setting")}`, ja: `設定を変更した ${pick("key", "setting")}`, ko: `설정 변경 ${pick("key", "setting")}`, en: `Updated setting ${pick("key", "setting")}` });
      default: {
        const detail = shorten(
          pick("file_path", "path", "query", "url", "command", "pattern", "prompt", "label", "title"),
          80,
        );
        return t({
          zh: `调用了 ${name}${detail ? `：${detail}` : ""}`,
          ja: `${name} を呼び出した${detail ? `：${detail}` : ""}`,
          ko: `${name} 호출${detail ? `: ${detail}` : ""}`,
          en: `Called ${name}${detail ? `: ${detail}` : ""}`,
        });
      }
    }
  }

  // ════════════════════════════
  //  滚动摘要
  // ════════════════════════════

  /**
   * 滚动更新 session 摘要：每 10 轮或 session 结束时触发。
   * 若有旧摘要则将旧摘要 + 新对话合并产出新摘要（覆盖，非追加）；
   * 若无旧摘要则直接从对话生成。
   * 输出格式固定为 rolling-summary-format.ts 契约规定的两节（facts + timeline）。
   *
   * @param {string} sessionId
   * @param {Array<{role: string, content: any, timestamp?: string}>} messages
   * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
   * @returns {Promise<string>} 更新后的摘要文本
   */
  async rollingSummary(sessionId, messages, resolvedModel, opts: Record<string, any> = {}) {
    const draft = await this.createRollingSummaryDraft(sessionId, messages, resolvedModel, opts);
    if (draft?.data) {
      this.saveSummary(sessionId, draft.data);
    }
    return opts.returnResult === true ? draft : (draft?.summary || "");
  }

  /**
   * 生成 legacy utility rolling summary 草稿但不落盘。
   * session_snapshot memory reflection 走 live session side-task runner，
   * 不通过这个 utility_template 冷路径。
   *
   * @param {string} sessionId
   * @param {Array<{role: string, content: any, timestamp?: string}>} messages
   * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
   * @returns {Promise<{summary: string, changed: boolean, data: object|null, usage?: object|null, reason?: string}>}
   */
  async createRollingSummaryDraft(sessionId, messages, resolvedModel, opts: Record<string, any> = {}) {
    const resetAt = latestSince(opts.resetAt, readCompiledResetAt(path.dirname(this.summariesDir)));
    const existingRaw = this.getSummary(sessionId);
    const existing = resetAt && existingRaw && !isAfter(existingRaw.updated_at || existingRaw.created_at, resetAt)
      ? null
      : existingRaw;
    const projection = normalizeBranchProjection(opts.projection);
    let mode = "legacy";
    let prevSummary = existing?.summary || "";
    let newMessages = messages;
    if (projection) {
      if (!existing) {
        mode = "initial";
        prevSummary = "";
      } else if (isCursorAncestorOfProjection(existing.cursor, projection)) {
        mode = "append";
        const coveredIndex = existing.cursor?.coveredLeafId == null
          ? -1
          : projection.lineage.findIndex((entry) => entry.id === existing.cursor.coveredLeafId);
        newMessages = messages.filter((message) => (
          Number.isInteger(message?.lineageIndex)
          && message.lineageIndex > coveredIndex
        ));
      } else {
        // messageCount cannot establish branch ancestry. Legacy summaries and
        // sibling/rewound branches must rebuild from the complete projection.
        mode = "replace";
        prevSummary = "";
      }
    } else {
      // 旧数据无 messageCount 时 fallback 到全量；显式 0 代表尚未覆盖任何消息。
      const hasMessageCount = Number.isInteger(existing?.messageCount) && existing.messageCount >= 0;
      const lastMessageCount = hasMessageCount ? existing.messageCount : 0;
      newMessages = hasMessageCount
        ? messages.slice(Math.min(lastMessageCount, messages.length))
        : messages;
    }

    const timeZone = resolveMemoryTimeZone(opts.timeZone);
    const sourceTimeRange = buildSourceTimeRange(messages, { timeZone });
    const convText = this._buildConversationText(newMessages, { timeZone });
    if (!convText) {
      if (projection) {
        const now = new Date().toISOString();
        const cursor = projectionCursor(projection);
        const replacement = mode === "replace";
        const summary = replacement ? "" : prevSummary;
        const cursorChanged = !sameCursor(existing?.cursor, cursor);
        const shouldSave = replacement || mode === "initial" || cursorChanged;
        return {
          summary,
          changed: replacement,
          mode,
          data: shouldSave ? {
            session_id: sessionId,
            created_at: existing?.created_at || now,
            updated_at: replacement ? now : (existing?.updated_at || now),
            summary,
            messageCount: messages.length,
            cursor,
            source_time_range: sourceTimeRange || (replacement ? null : existing?.source_time_range || null),
            snapshot: existing?.snapshot || "",
            snapshotCursor: existing?.snapshotCursor || null,
            snapshot_at: existing?.snapshot_at || null,
            factReplacementRequired: replacement || existing?.factReplacementRequired === true,
          } : null,
          usage: null,
          reason: replacement ? "empty_branch_replacement" : "empty_conversation",
        };
      }
      return {
        summary: prevSummary,
        changed: false,
        mode,
        data: null,
        usage: null,
        reason: "empty_conversation",
      };
    }

    // 按全量用户轮数计算摘要配额（预算反映对话整体体量，输入只传增量）
    const turnCount = messages.filter((m) => m.role === "user").length;
    const llmResult = await this._callRollingLLM(convText, prevSummary, resolvedModel, turnCount, {
      memoryReflectionSnapshot: opts.memoryReflectionSnapshot,
      returnUsage: opts.returnUsage,
      usageTrigger: opts.usageTrigger,
    });
    let usage = typeof llmResult === "object" && llmResult !== null ? llmResult.usage || null : null;
    let newSummary: any = typeof llmResult === "object" && llmResult !== null ? llmResult.text : llmResult;
    if (!newSummary?.trim()) {
      return {
        summary: prevSummary,
        changed: false,
        mode,
        data: null,
        usage,
        reason: "empty_output",
      };
    }

    // 写入前结构校验 + 有限次数格式修复（#1628）：摘要必须满足 compileEditableFacts
    // 的提取假设，否则 facts 会在编译侧静默丢失。最终修不好就抛错，由调用方
    // （memory ticker / 日记回填）按既有失败通道记录，旧摘要保持不被覆盖。
    let repairsUsed = 0;
    let validation = validateRollingSummaryFormat(newSummary);
    while (!validation.ok && repairsUsed < MAX_ROLLING_SUMMARY_FORMAT_REPAIRS) {
      repairsUsed += 1;
      log.warn(`rolling summary format invalid for ${sessionId} (${validation.issues.join("; ")}), repair attempt ${repairsUsed}/${MAX_ROLLING_SUMMARY_FORMAT_REPAIRS}`);
      const repairResult = await this._callRollingRepairLLM(newSummary, validation.issues, resolvedModel, turnCount, {
        returnUsage: opts.returnUsage,
        usageTrigger: opts.usageTrigger,
      });
      usage = typeof repairResult === "object" && repairResult !== null ? repairResult.usage || null : usage;
      newSummary = typeof repairResult === "object" && repairResult !== null ? repairResult.text : repairResult;
      if (!newSummary?.trim()) {
        validation = { ok: false, issues: [...validation.issues, "format repair attempt returned empty output"] };
        break;
      }
      validation = validateRollingSummaryFormat(newSummary);
    }
    if (!validation.ok) {
      throw new Error(`rolling summary format invalid after ${repairsUsed} repair attempt(s): ${validation.issues.join("; ")}`);
    }

    if (projection && typeof opts.revalidateProjection === "function") {
      const latestProjection = normalizeBranchProjection(await opts.revalidateProjection());
      if (!latestProjection || !projectionRemainsAncestor(projection, latestProjection)) {
        return {
          summary: existing?.summary || "",
          changed: false,
          mode,
          data: null,
          usage,
          reason: "branch_changed",
        };
      }
    }

    const latestResetAt = latestSince(resetAt, readCompiledResetAt(path.dirname(this.summariesDir)));
    if (latestResetAt && !areMessagesAfter(messages, latestResetAt)) {
      return {
        summary: prevSummary,
        changed: false,
        mode,
        data: null,
        usage,
        reason: "reset_watermark",
      };
    }

    // PII 脱敏
    const { cleaned: scrubbedRolling, detected: rollingDetected } = scrubPII(newSummary);
    if (rollingDetected.length > 0) {
      log.warn(`PII detected in rolling summary (${rollingDetected.join(", ")}), redacted`);
      newSummary = scrubbedRolling;
    }

    // 脱敏是结构保持操作；这里再守一道，确保最终落盘文本仍满足提取假设
    const finalValidation = validateRollingSummaryFormat(newSummary);
    if (!finalValidation.ok) {
      throw new Error(`rolling summary format invalid after PII scrub: ${finalValidation.issues.join("; ")}`);
    }

    const now = new Date().toISOString();
    const data = {
      session_id: sessionId,
      created_at: existing?.created_at || now,
      updated_at: now,
      summary: newSummary.trim(),
      messageCount: messages.length, // 记录已覆盖的消息总数
      ...(projection ? { cursor: projectionCursor(projection) } : {}),
      source_time_range: sourceTimeRange || existing?.source_time_range || null,
      snapshot: existing?.snapshot || "",
      snapshotCursor: existing?.snapshotCursor || null,
      snapshot_at: existing?.snapshot_at || null,
      ...(existingRaw?.fork_baseline ? { fork_baseline: existingRaw.fork_baseline } : {}),
      factReplacementRequired: mode === "replace" || existing?.factReplacementRequired === true,
    };

    return {
      summary: newSummary.trim(),
      changed: true,
      mode,
      data,
      usage,
      reason: rollingDetected.length > 0 ? "pii_redacted" : "",
    };
  }

  /**
   * 滚动摘要的输出预算（单一来源，初次生成与格式修复共用 visibleMaxTokens）
   * @param {number} turnCount
   * @returns {{ totalBudget: number, visibleMaxTokens: number }}
   */
  _rollingSummaryBudget(turnCount) {
    // 按轮数线性缩放：每轮 40 字配额，10 轮封顶 400 字
    const totalBudget = Math.min(400, Math.max(40, turnCount * 40));
    // max_tokens 跟着配额走，避免固定值引导 LLM 写满
    const visibleMaxTokens = Math.max(150, Math.min(750, Math.round(totalBudget * 1.5)));
    return { totalBudget, visibleMaxTokens };
  }

  /**
   * 格式修复调用：把不满足 compileEditableFacts 提取假设的摘要草稿重排进契约结构。
   * 只基于草稿本身修复（不重发对话内容），信息不增删。
   * @param {string} summaryText - 待修复的摘要草稿
   * @param {string[]} issues - validateRollingSummaryFormat 给出的失败原因
   * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
   * @param {number} turnCount
   * @returns {Promise<string | { text: string, usage: object|null }>}
   */
  async _callRollingRepairLLM(summaryText, issues, resolvedModel, turnCount = 10, opts: Record<string, any> = {}) {
    const locale = getLocale();
    const { visibleMaxTokens } = this._rollingSummaryBudget(turnCount);
    const layout = buildUtilityPromptLayout({
      cacheGroup: "memory.rolling_summary",
      templateVersion: "rolling-summary-repair.v1",
      systemPrompt: buildRollingSummaryRepairPrompt(locale),
      userContent: buildRollingSummaryRepairInput({ locale, issues, summaryText }),
    });
    const usageContext = attachPromptLayoutMetadata({
      source: {
        subsystem: "memory",
        // 与初次生成（rolling_summary）可区分，修复用量不混进初次的账目
        operation: "rolling_summary_repair",
        surface: "system",
        trigger: opts.usageTrigger || "threshold",
      },
      attribution: {
        kind: "memory",
        agentId: resolvedModel.usageAgentId || null,
      },
    }, layout.usageMetadata);

    return callText({
      ...callTextConfigFromResolvedModel(resolvedModel),
      systemPrompt: layout.systemPrompt,
      messages: layout.messages,
      temperature: 0.3,
      maxTokens: withMemoryReasoningBuffer(visibleMaxTokens, resolvedModel),
      timeoutMs: DEFAULT_CALL_TEXT_TIMEOUT_MS,
      signal: undefined,
      returnUsage: opts.returnUsage === true,
      usageLedger: resolvedModel.usageLedger,
      usageContext,
    });
  }

  /**
   * 调用 LLM 生成滚动摘要（两节格式）
   * @param {string} convText - 本次对话文本
   * @param {string} prevSummary - 上一次摘要（可为空）
   * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
   * @returns {Promise<string>}
   */
  async _callRollingLLM(convText, prevSummary, resolvedModel, turnCount = 10, opts: Record<string, any> = {}) {
    const locale = getLocale();
    const lang = normalizePromptLang(locale);
    const isZh = lang === "zh" || lang === "zh-TW";
    const hasPrev = !!prevSummary;
    const memorySnapshot = normalizeMemoryReflectionSnapshot(opts.memoryReflectionSnapshot);
    const agentName = memorySnapshot.agentName || pickPromptText(lang, { zh: "这个 Agent", ja: "この Agent", ko: "이 Agent", fr: "cet Agent", de: "dieser Agent", en: "this agent" });
    const userName = memorySnapshot.userName || pickPromptText(lang, { zh: "主人", ja: "オーナー", ko: "오너", fr: "l'utilisateur", de: "der Benutzer", en: "the user" });
    const notProvided = pickPromptText(lang, { zh: "（未提供）", ja: "（未提供）", ko: "(미제공)", fr: "(non fourni)", de: "(nicht bereitgestellt)", en: "(Not provided)" });
    const identityAndPersonality = memorySnapshot.identityAndPersonality || notProvided;
    const userProfile = memorySnapshot.userProfile || notProvided;
    const existingMemory = memorySnapshot.existingMemory || pickPromptText(lang, { zh: "（暂无已有长期记忆）", ja: "（既存の長期記憶はまだありません）", ko: "(기존 장기 기억 없음)", fr: "(pas encore de mémoire long terme)", de: "(noch kein Langzeitgedächtnis)", en: "(No existing long-term memory)" });
    const roster = memorySnapshot.roster || pickPromptText(lang, { zh: "（没有其他 Agent）", ja: "（他の Agent はいません）", ko: "(다른 Agent 없음)", fr: "(aucun autre Agent)", de: "(keine anderen Agenten)", en: "(No other agents)" });
    const formatRequirements = buildRollingSummaryFormatRequirements(locale);
    // 标题文本统一从格式契约取，prompt 文案禁止硬编码标题字面量
    const factTitle = getFactSectionTitle(locale);
    const timelineTitle = getTimelineSectionTitle(locale);

    const { totalBudget, visibleMaxTokens } = this._rollingSummaryBudget(turnCount);
    const factsBudget = Math.max(15, Math.round(totalBudget * 0.3));
    const eventsBudget = totalBudget - factsBudget;

    // 英文 budget 按 word 估算（约 1.5x 字符比）
    const factsWordBudget = Math.max(10, Math.round(factsBudget * 0.6));
    const eventsWordBudget = Math.max(20, Math.round(eventsBudget * 0.6));

    const systemPrompt = lang === "ja"
      ? `あなたは ${agentName} です。自分がちょうど経験した会話を整理しています。

以下は、この会話が始まる前にすでに持っていた設定と記憶です。それらは背景であり、新しい事実ではありません。自分の視点から今回の会話を吟味し、どの新しい情報が長期記憶に入る値打ちがあるかを判断してください。

## あなたのアイデンティティと人格
${identityAndPersonality}

## オーナー（ユーザー）設定
${userProfile}

## あなたがすでに持っている長期記憶
これはこの会話が始まる前からあなたが持っていた記憶です。ここに表示されたからといって書き直さないこと。今回の会話がそれを更新・反証・補強するときだけ変化を記録してください。

${existingMemory}

## 名簿
名簿は、このシステムに共存する他の Agent を知るためのものです。会話に登場する Agent の名前と協作の文脈を理解するためだけに使い、名簿そのものを新しい記憶として書き込まないこと。

${roster}

## 核心原則
記憶の中核の役割は、${userName} という人への理解を維持し、今後その人と、二人の関係、長期プロジェクト、共有される文脈をより自然に理解できるようにすることです。サマリーは依然としてユーザー側を中心にする：${userName} が誰か、何が好きか、何を気にかけているか、最近どの大きなテーマに注目しているかを優先的に記録してください。あなたの返信については、具体的な内容やその場の内心は記録せず、「何をしたか」（例：「X についての記事を生成した」「Y 機能を実装するコードを書いた」）だけを記録してください。

${formatRequirements}

## 内容の要件

**${factTitle} セクション**
ユーザー像に関する情報だけを記録する：属性（アイデンティティ）、人格的特徴、審美観と興味、好き嫌い、長期的な人間関係、生活や創作の志向、最近注目・傾注している大きなテーマ。なければ \`- None\` と書くこと。

抽出しないもの：
- 仕事の進め方の好み：ユーザーがアシスタントにどう調査・計画・実装・テスト・報告・commit・push してほしいか
- 協作の流れの好み：ユーザーが求める手順、確認ポイント、検証順序、コンテキスト管理の方式
- ツールとプラットフォームの好み：あるタスクでどのツール、コマンド、ファイル、モデル、ディレクトリを使ったか
- エンジニアリング規律とプロジェクト規則：これらはプロジェクト文書やシステムルールに属し、ユーザー像の記憶には属さない
- 1 回のタスクにおけるフォーマット、基準、その場の判断

抽出するもの：
- ユーザーがどんな人か
- ユーザーが好きまたは嫌いな対象、スタイル、コンテンツ、体験
- ユーザーが長期的に気にかけているテーマ、関係、アイデンティティ、審美観、価値観
- ユーザーが最近どの分野/プロジェクト/テーマに注目しているか（大きなテーマだけを残し、詳細は残さない）

判別の基準：
- その情報が「このユーザーは誰か、何が好きか、何を気にかけているか」に答えるものなら、抽出してよい。
- その情報が「このユーザーと作業するときはどうすべきか」に答えるものなら、抽出しない。
- その情報が「ユーザーは最近どの分野/プロジェクト/テーマに注目しているか」に答えるものなら、大きなテーマだけを残し、そのテーマ内の詳細は残さない。
- 迷ったら一律抽出しない。抜けを恐れるより、誤記を恐れる。

字数要件：実際の情報量に応じて書き、今回のサマリー予算を守ること。情報が少なければ短く書き、字数を水増ししないこと。

**${timelineTitle} セクション**
時間順に、この session で何が起きたかを記録する。YYYY-MM-DD HH:MM の時刻表記を付け、要点の流れをつかむこと。仕事関連の内容は大きなテーマ階層までしか残せない。
仕事の内容は「ユーザーが記憶システムを議論していた」「ユーザーが Project Jarvis を進めていた」のように書き、具体的な部分問題、解決策、ファイル、ツール、コマンド、テスト、実行手順、確認順序、協作の好みは書かないこと。
字数要件：実際の情報量に応じて書き、今回のサマリー予算を守ること。三文で済むことを一段落にしないこと。

## ルール
1. 既存サマリーがある場合：新しい内容と古い内容を統合し、同じ出来事は新しい情報を優先し、重複させない
2. 時刻表記はメッセージのタイムスタンプから取り込む（YYYY-MM-DD HH:MM 形式）
3. 客観的事実だけを記録し、MOOD やアシスタントの内心は記録しない
4. ユーザーが提供したファイル/添付：ファイル名と用途だけを記録し、具体的な内容は無視する
5. アシスタントの長文出力（記事、コード、分析など）：何を産出したかだけを記録し、内容を引用しない
6. 短くする：サマリーの長さは会話の実際の情報密度に比例させ、雑談数句なら一〜二行でよい`
      : lang === "ko"
      ? `당신은 ${agentName}입니다. 방금 경험한 대화를 정리하고 있습니다.

아래는 이 대화가 시작되기 전에 이미 갖고 있던 설정과 기억입니다. 그것들은 배경이지 새로운 사실이 아닙니다. 자신의 시각에서 이번 대화를 검토하고, 어떤 새로운 정보가 장기 기억에 들어갈 가치가 있는지 판단하세요.

## 당신의 정체성과 인격
${identityAndPersonality}

## 오너(사용자) 설정
${userProfile}

## 당신이 이미 갖고 있는 장기 기억
이것은 이 대화가 시작되기 전부터 당신이 갖고 있던 기억입니다. 여기에 나타났다는 이유만으로 다시 쓰지 말 것. 이번 대화가 그것을 갱신·반박·보강할 때만 변화를 기록하세요.

${existingMemory}

## 명부
명부는 이 시스템에 함께 있는 다른 Agent를 알기 위한 것입니다. 대화에 등장하는 Agent의 이름과 협업 맥락을 이해하는 데만 사용하고, 명부 자체를 새로운 기억으로 기록하지 말 것.

${roster}

## 핵심 원칙
기억의 핵심 역할은 ${userName}라는 사람에 대한 이해를 유지하여, 앞으로 그 사람과, 두 사람의 관계, 장기 프로젝트, 공유된 맥락을 더 자연스럽게 이해할 수 있게 하는 것입니다. 요약은 여전히 사용자 측을 중심으로 합니다: ${userName}가 누구인지, 무엇을 좋아하는지, 무엇을 신경 쓰는지, 최근 어떤 큰 주제에 주목하는지를 우선 기록하세요. 당신의 답변에 대해서는 구체적인 내용이나 그 순간의 내심을 기록하지 말고 "무엇을 했는지"(예: "X에 관한 글을 생성했다", "Y 기능을 구현하는 코드를 작성했다")만 기록하세요.

${formatRequirements}

## 내용 요구사항

**${factTitle} 섹션**
사용자 프로필류 정보만 기록: 정체성 속성, 성격 특성, 심미감과 관심사, 좋아하거나 싫어하는 것, 장기 관계, 생활이나 창작 지향, 최근 주목하고 몰두하는 큰 주제. 없으면 \`- None\`로 쓸 것.

뽑지 말 것:
- 업무 방식 선호: 사용자가 어시스턴트에게 어떻게 조사·계획·구현·테스트·보고·commit·push하길 원하는지
- 협업 절차 선호: 사용자가 요구하는 단계, 확인 지점, 검증 순서, 컨텍스트 관리 방식
- 도구와 플랫폼 선호: 어떤 작업에서 어떤 도구, 명령어, 파일, 모델, 디렉터리를 썼는지
- 엔지니어링 규율과 프로젝트 규칙: 이것들은 프로젝트 문서나 시스템 규칙에 속하며 사용자 프로필 기억에 속하지 않음
- 한 번의 작업에서의 포맷, 기준, 임시 판단

뽑을 것:
- 사용자가 어떤 사람인지
- 사용자가 좋아하거나 싫어하는 대상, 스타일, 콘텐츠, 경험
- 사용자가 오랫동안 신경 쓰는 주제, 관계, 정체성, 심미감, 가치관
- 사용자가 최근 어떤 분야/프로젝트/주제에 주목하는지(큰 주제만 남기고 세부사항은 남기지 않음)

판별 기준:
- 그 정보가 "이 사용자는 누구인가, 무엇을 좋아하는가, 무엇을 신경 쓰는가"에 답한다면 뽑아도 된다.
- 그 정보가 "이 사용자와 작업할 때 어떻게 해야 하는가"에 답한다면 뽑지 말 것.
- 그 정보가 "사용자가 최근 어떤 분야/프로젝트/주제에 주목하는가"에 답한다면 큰 주제만 남기고 그 주제 안의 세부사항은 남기지 말 것.
- 확신이 서지 않으면 무조건 뽑지 말 것. 놓치는 것보다 잘못 기록하는 것이 나쁘다.

글자 수 요구사항: 실제 정보량에 맞게 쓰고 이번 요약 예산을 지킬 것. 정보가 적으면 짧게 쓰고 글자 수를 채우려 하지 말 것.

**${timelineTitle} 섹션**
시간 순서대로 이 session에서 무엇이 일어났는지 기록. YYYY-MM-DD HH:MM 시각 표기를 붙이고 핵심 흐름을 잡을 것. 업무 관련 내용은 큰 주제 수준까지만 남길 수 있다.
업무 내용은 "사용자가 기억 시스템을 논의하고 있었다", "사용자가 Project Jarvis를 진행하고 있었다"처럼 쓰고, 구체적인 하위 문제, 방안, 파일, 도구, 명령어, 테스트, 실행 단계, 확인 순서, 협업 선호는 쓰지 말 것.
글자 수 요구사항: 실제 정보량에 맞게 쓰고 이번 요약 예산을 지킬 것. 세 문장으로 충분한 것을 한 단락으로 쓰지 말 것.

## 규칙
1. 기존 요약이 있을 때: 새 내용과 옛 내용을 병합하고, 같은 사건은 새 정보를 우선하며 중복하지 말 것
2. 시각 표기는 메시지 타임스탬프에서 뽑을 것(YYYY-MM-DD HH:MM 형식)
3. 객관적 사실만 기록하고 MOOD나 어시스턴트의 내심은 기록하지 말 것
4. 사용자가 제공한 파일/첨부: 파일명과 용도만 기록하고 파일의 구체적인 내용은 무시할 것
5. 어시스턴트의 긴 출력(글, 코드, 분석 등): 무엇을 산출했는지만 기록하고 내용을 발췌하지 말 것
6. 짧게: 요약 길이는 대화의 실제 정보 밀도에 비례해야 하고, 잡담 몇 마디면 한두 줄이면 충분`
      : lang === "fr"
      ? `Tu es ${agentName}. Tu examines une conversation que tu viens de vivre.

Voici les réglages et mémoires que tu possédais déjà au début de cette session. Ce sont des arrière-plans, pas des faits nouveaux. Examine la conversation de ton propre point de vue et juge quelles nouvelles informations méritent d'entrer dans la mémoire long terme.

## Ton identité et ta personnalité
${identityAndPersonality}

## Réglages du propriétaire (utilisateur)
${userProfile}

## Ta mémoire long terme existante
C'est la mémoire que tu possédais avant le début de cette conversation. Ne la réécris pas parce qu'elle apparaît ici ; n'enregistre des changements que lorsque cette conversation la met à jour, la contredit ou la renforce.

${existingMemory}

## Annuaire
L'annuaire te présente les autres Agent coexistant dans ce système. Il sert uniquement à comprendre les noms d'Agent et le contexte de collaboration ; ne traite pas l'annuaire lui-même comme une mémoire nouvelle.

${roster}

## Principe central
Le rôle central de la mémoire est de maintenir ta compréhension de ${userName} : qui cette personne est, votre relation, ses projets de long terme et le contexte partagé. Le résumé reste centré utilisateur : priorise qui est ${userName}, ce qu'il aime, ce qui lui tient à cœur, les grands thèmes qu'il suit récemment. Pour tes réponses, n'enregistre que « ce qui a été fait » (ex. « a rédigé un article sur X », « a écrit du code implémentant Y »), pas le contenu concret ni les pensées intérieures du moment.

${formatRequirements}

## Exigences de contenu

**Section ${factTitle}**
N'enregistre que les informations de type portrait utilisateur : attributs d'identité, traits de personnalité, esthétique et intérêts, goûts et aversions, relations durables, orientations de vie ou de création, grands thèmes récemment suivis ou investis. Écris \`- None\` s'il n'y en a pas.

À ne pas extraire :
- Préférences de façon de travailler : comment l'utilisateur veut que l'assistant examine, planifie, investigue, implémente, teste, rende compte, commit, push
- Préférences de flux de collaboration : étapes, points de confirmation, ordre de vérification, gestion du contexte exigés par l'utilisateur
- Préférences d'outils et de plateformes d'une tâche : outils, commandes, fichiers, modèles, répertoires
- Discipline d'ingénierie et règles de projet : elles appartiennent aux documents de projet ou aux règles système, pas à la mémoire de portrait
- Formats, standards et jugements ponctuels d'une seule tâche

À extraire :
- Quelle sorte de personne est l'utilisateur
- Quels objets, styles, contenus et expériences l'utilisateur aime ou n'aime pas
- Les thèmes, relations, identité, esthétique et valeurs dont l'utilisateur se soucie depuis longtemps
- Quel domaine / projet / thème l'utilisateur suit récemment, en gardant seulement le grand thème sans les détails

Critères de discernement :
- Si l'information répond à « qui est cet utilisateur, qu'aime-t-il, à quoi tient-il », extrais-la.
- Si l'information répond à « comment travailler avec cet utilisateur », ne l'extrais pas.
- Si l'information répond à « quel domaine / projet / thème l'utilisateur suit-il récemment », garde seulement le grand thème, sans les détails à l'intérieur.
- Dans le doute, n'extrais pas. Mieux vaut manquer que mal enregistrer.

Limite de longueur : écris selon la quantité réelle d'information, dans le budget de résumé de cette exécution. Peu d'informations → écris court, sans gonfler le texte.

**Section ${timelineTitle}**
Enregistre chronologiquement ce qui s'est passé dans cette session, avec des horodatages YYYY-MM-DD HH:MM, en saisissant les fils conducteurs. Le contenu professionnel ne peut être conservé qu'au niveau des grands thèmes.
Écris le travail comme « l'utilisateur discutait des systèmes de mémoire » ou « l'utilisateur avançait sur Project Jarvis » ; n'écris pas de sous-problèmes, solutions, fichiers, outils, commandes, tests, étapes d'exécution, ordre de vérification ni préférences de collaboration.
Limite de longueur : écris selon la quantité réelle d'information, dans le budget de résumé de cette exécution. Ce qui tient en trois phrases ne devient pas un paragraphe.

## Règles
1. S'il existe un résumé antérieur : fusionne l'ancien et le nouveau ; pour un même fait, la nouvelle information prime ; pas de doublons
2. Les horodatages sont tirés des timestamps des messages (format YYYY-MM-DD HH:MM)
3. N'enregistre que des faits objectifs, ni MOOD ni pensées intérieures de l'assistant
4. Fichiers / pièces jointes fournis par l'utilisateur : n'enregistre que le nom et l'usage, ignore le contenu du fichier
5. Longues sorties de l'assistant (articles, code, analyses) : n'enregistre que ce qui a été produit, sans en citer le contenu
6. Plutôt court : la longueur du résumé doit être proportionnelle à la densité d'information réelle`
      : lang === "de"
      ? `Du bist ${agentName}. Du ordnest ein Gespräch auf, das du gerade erlebt hast.

Unten stehen die Einstellungen und Speicher, die du schon zu Beginn dieser Session hattest. Sie sind Hintergrund, keine neuen Fakten. Sieh das Gespräch aus deiner eigenen Perspektive durch und urteile, welche neuen Informationen den Wert einer Langzeiterinnerung haben.

## Deine Identität und Persönlichkeit
${identityAndPersonality}

## Einstellungen des Besitzers (Benutzer)
${userProfile}

## Dein vorhandenes Langzeitgedächtnis
Das ist der Speicher, den du schon vor Beginn dieses Gesprächs hattest. Schreibe ihn nicht neu, nur weil er hier erscheint; zeichne Veränderungen nur auf, wenn dieses Gespräch ihn aktualisiert, widerlegt oder bekräftigt.

${existingMemory}

## Verzeichnis
Das Verzeichnis zeigt dir die anderen Agent, die in diesem System koexistieren. Es dient nur dazu, die Agentennamen und den Kollaborationskontext zu verstehen; behandle das Verzeichnis selbst nicht als neuen Speicher.

${roster}

## Kernprinzip
Die Kernaufgabe des Speichers ist es, dein Verständnis von ${userName} zu pflegen: wer diese Person ist, eure Beziehung, ihre Langzeitprojekte und der geteilte Kontext. Die Zusammenfassung bleibt benutzerzentriert: priorisiere, wer ${userName} ist, was er mag, was ihm wichtig ist, welchen großen Themen er kürzlich folgt. Für deine Antworten zeichne nur „was getan wurde" auf (z. B. „einen Artikel über X geschrieben", „Code geschrieben, der Y implementiert"), nicht den konkreten Inhalt und keine momentanen inneren Gedanken.

${formatRequirements}

## Inhaltsanforderungen

**Abschnitt ${factTitle}**
Zeichne nur Informationen vom Typ Benutzerporträt auf: Identitätsattribute, Persönlichkeitsmerkmale, Ästhetik und Interessen, Vorlieben und Abneigungen, langfristige Beziehungen, Lebens- oder Schaffensausrichtung, große kürzlich verfolgte Themen. Schreibe \`- None\`, wenn es keine gibt.

Nicht extrahieren:
- Arbeitsstilpräferenzen: wie der Benutzer will, dass der Assistent prüft, plant, recherchiert, implementiert, testet, berichtet, committet, pusht
- Kollaborationsablaufpräferenzen: geforderte Schritte, Bestätigungspunkte, Prüfreihenfolge, Kontextverwaltung
- Werkzeug- und Plattformpräferenzen einer Aufgabe: Werkzeuge, Befehle, Dateien, Modelle, Verzeichnisse
- Ingenieurdisziplin und Projektrichtlinien: die gehören zu Projektdokumenten oder Systemregeln, nicht zum Porträtspeicher
- Formate, Standards und Ad-hoc-Urteile einer einzelnen Aufgabe

Zu extrahieren:
- Was für ein Mensch der Benutzer ist
- Welche Objekte, Stile, Inhalte und Erfahrungen der Benutzer mag oder ablehnt
- Themen, Beziehungen, Identität, Ästhetik und Werte, die dem Benutzer langfristig wichtig sind
- Welchem Feld / Projekt / Thema der Benutzer kürzlich folgt, nur das große Thema ohne Details

Unterscheidungskriterien:
- Beantwortet die Information „Wer ist dieser Benutzer, was mag er, was ist ihm wichtig", darfst du extrahieren.
- Beantwortet die Information „Wie arbeitet man mit diesem Benutzer", extrahiere nicht.
- Beantwortet die Information „Welchem Feld / Projekt / Thema folgt der Benutzer kürzlich", behalte nur das große Thema, ohne die Details darin.
- Im Zweifel nicht extrahieren. Lieber verpassen als falsch aufzeichnen.

Längenbegrenzung: schreibe nach der tatsächlichen Informationsmenge, im Zusammenfassungsbudget dieses Laufs. Wenig Information → kurz schreiben, ohne Länge aufzublähen.

**Abschnitt ${timelineTitle}**
Zeichne chronologisch auf, was in dieser Session geschah, mit Zeitstempeln YYYY-MM-DD HH:MM, und erfasse die Kernstränge. Arbeitsbezogene Inhalte dürfen nur auf der Ebene der großen Themen bleiben.
Schreibe Arbeit als „der Benutzer diskutierte Speichersysteme" oder „der Benutzer arbeitete an Project Jarvis"; schreibe keine Teilprobleme, Lösungen, Dateien, Werkzeuge, Befehle, Tests, Ausführungsschritte, Prüfreihenfolge oder Kollaborationspräferenzen.
Längenbegrenzung: schreibe nach der tatsächlichen Informationsmenge, im Zusammenfassungsbudget dieses Laufs. Was in drei Sätzen klar ist, wird kein Absatz.

## Regeln
1. Gibt es eine bestehende Zusammenfassung: alten und neuen Inhalt verschmelzen; bei demselben Fakt zählt die neue Information; keine Duplikate
2. Zeitstempel aus den Nachrichtenzeitstempeln übernehmen (Format YYYY-MM-DD HH:MM)
3. Nur objektive Fakten aufzeichnen, kein MOOD und keine inneren Gedanken des Assistenten
4. Vom Benutzer bereitgestellte Dateien / Anhänge: nur Dateiname und Zweck aufzeichnen, den Inhalt ignorieren
5. Lange Ausgaben des Assistenten (Artikel, Code, Analysen): nur aufzeichnen, was produziert wurde, ohne den Inhalt zu zitieren
6. Lieber kurz: die Länge der Zusammenfassung soll der tatsächlichen Informationsdichte entsprechen`
      : isZh
      ? `你是 ${agentName}。你正在整理自己刚刚经历的一段对话。

下面是你在本次对话开始前已经拥有的设定和记忆。它们是背景，不是新增事实。请从自己的视角审视本次对话，判断哪些新信息值得进入长期记忆。

## 你的身份与人格
${identityAndPersonality}

## 主人设定
${userProfile}

## 你已有的长期记忆
这是你在本次对话开始前已经拥有的记忆。不要因为它出现在这里就重复写入；只有本次对话更新、反驳、强化它时才记录变化。

${existingMemory}

## 花名册
花名册告诉你同处于这个系统里的别的 Agent。它只用于理解对话中的 Agent 名字和协作语境，不要把花名册本身当作新增记忆。

${roster}

## 核心原则
记忆的核心职责是维护你对${userName}的理解，让你以后更自然地理解这个人、你们的关系、长期项目和共同语境。摘要仍然以用户侧为中心：优先记录${userName}是谁、喜欢什么、在意什么、最近关注什么大主题。你的回复只需记录"做了什么"（如"生成了一篇关于X的文章""写了一段代码实现Y功能"），不记录回复的具体内容，也不记录即时内心想法。

${formatRequirements}

## 内容要求

**${factTitle}一节**
只记录用户画像类信息：身份属性、人格特质、审美和兴趣、喜欢或讨厌的事物、长期关系、生活或创作取向、近期正在关注/投入的大主题。没有则写 \`- 无\`。

不要抽：
- 工作方式偏好：用户希望助手怎样审查、规划、调研、实现、测试、汇报、commit、push
- 协作流程偏好：用户要求的步骤、确认点、验证顺序、上下文管理方式
- 工具和平台偏好：某次任务中使用什么工具、命令、文件、模型、目录
- 工程纪律和项目规则：这些属于项目文档或系统规则，不属于用户画像记忆
- 一次任务里的格式、标准、临时判断

只抽：
- 用户是什么样的人
- 用户喜欢或讨厌什么对象、风格、内容、体验
- 用户长期在意的主题、关系、身份、审美、价值取向
- 用户最近正在关注哪个领域/项目/主题，只保留大主题，不保留细节

判别标准：
- 如果这条信息回答的是“用户是谁、喜欢什么、在意什么”，可以抽。
- 如果这条信息回答的是“和用户工作时该怎么做”，不要抽。
- 如果这条信息回答的是“用户最近在关注哪个领域/项目/主题”，只保留大主题，不保留该主题里的细节。
- 拿不准一律不抽。宁可漏，不可错。

字数要求：按实际信息量写，遵守本次摘要预算。信息少就写短，不要凑字数。

**${timelineTitle}一节**
按时间顺序记录本 session 发生了什么，带 YYYY-MM-DD HH:MM 时间标注，抓重点脉络。工作相关内容只允许保留到大主题层级。
工作内容可以写成“用户在讨论记忆系统”“用户在做 Project Jarvis”，不要写具体子问题、方案、文件、工具、命令、测试、执行步骤、检查顺序或协作偏好。
字数要求：按实际信息量写，遵守本次摘要预算。三句话能说清的事不要写成一段。

## 规则
1. 有已有摘要时：新旧内容合并，同一件事以新信息为准，不要重复
2. 时间标注从消息时间戳提取（YYYY-MM-DD HH:MM 格式）
3. 只记录客观事实，不记录 MOOD 或助手内心想法
4. 用户提供的文件/附件：只记录文件名和用途，忽略文件的具体内容
5. 助手的长篇输出（文章、代码、分析等）：只记录产出了什么，不摘录内容
6. 宁短勿长：摘要长度应与对话的实际信息密度成正比，闲聊几句只需一两行`
      : `You are ${agentName}. You are reviewing a conversation you just experienced.

Below are the identity, settings, and memories you already had at the start of this session. They are background, not new facts. Review the new conversation from your own perspective and decide what deserves long-term memory.

## Your Identity And Personality
${identityAndPersonality}

## Owner / User Settings
${userProfile}

## Your Existing Long-Term Memory
This is the memory you already had before this conversation began. Do not rewrite it merely because it appears here; record only what this conversation updates, contradicts, or reinforces.

${existingMemory}

## Roster
The roster tells you which other agents are in the same system. Use it only to understand agent names and collaboration context; do not treat the roster itself as new memory.

${roster}

## Core Principle
Memory's core job is to maintain your understanding of ${userName}: who they are, your relationship with them, their long-running projects, and shared context. Keep the summary user-centric: prioritize who the user is, what they like, what they care about, and the broad themes they are currently focused on. For your replies, only record what was done (e.g. "generated an article about X", "wrote code implementing Y"), not the actual content or transient inner thoughts.

${formatRequirements}

## Content Requirements

**${factTitle} section**
Only record user-profile information: identity attributes, personality traits, aesthetics and interests, likes and dislikes, long-term relationships, life or creative orientation, and broad current themes the user is focused on. Write \`- None\` if none.

Do NOT extract:
- Work-style preferences: how the user wants the assistant to review, plan, research, implement, test, report, commit, or push
- Collaboration-process preferences: steps, checkpoints, validation order, context-management rules
- Tool and platform preferences from a task: tools, commands, files, models, directories
- Engineering discipline and project rules: these belong in explicit project instructions, not profile memory
- One-task formats, standards, or temporary judgments

ONLY extract:
- What kind of person the user is
- What objects, styles, content, and experiences the user likes or dislikes
- Long-term themes, relationships, identity, aesthetics, and values the user cares about
- Which domain/project/theme the user is currently focused on, keeping only the broad theme and no details

Test:
- If the information answers "who is the user, what do they like, what do they care about", extract it.
- If the information answers "how should one work with the user", do not extract it.
- If the information answers "which domain/project/theme is the user focused on recently", keep only the broad theme and no details inside that theme.
- When in doubt, skip. Better miss than mis-record.

Word limit: follow the per-run summary budget. Keep it short if there's little info.

**${timelineTitle} section**
Record what happened in this session in chronological order with YYYY-MM-DD HH:MM timestamps, capturing key points. Work-related content may only be kept at the broad-theme level.
Work can be written as "the user discussed memory systems" or "the user worked on Project Jarvis"; do not record subproblems, proposals, files, tools, commands, tests, execution steps, validation order, or collaboration preferences.
Word limit: follow the per-run summary budget. If three sentences suffice, don't write a paragraph.

## Rules
1. When existing summary is present: merge old and new, use newer info for the same topic, no duplicates
2. Extract time annotations from message timestamps (YYYY-MM-DD HH:MM format)
3. Only record objective facts, not MOOD or assistant's inner thoughts
4. User-provided files/attachments: only record filename and purpose, ignore file contents
5. Assistant's long outputs (articles, code, analysis): only record what was produced, don't excerpt content
6. Prefer brevity: summary length should be proportional to actual information density`;

    const prevLabel = pickPromptText(lang, { zh: "## 已有摘要", ja: "## 既存サマリー", ko: "## 기존 요약", fr: "## Résumé existant", de: "## Vorhandene Zusammenfassung", en: "## Existing Summary" });
    const newLabel = pickPromptText(lang, { zh: "## 新增对话", ja: "## 新しい会話", ko: "## 새 대화", fr: "## Nouvelle conversation", de: "## Neue Unterhaltung", en: "## New Conversation" });
    const budgetLabel = pickPromptText(lang, { zh: "## 本次摘要预算", ja: "## 今回のサマリー予算", ko: "## 이번 요약 예산", fr: "## Budget de résumé de cette exécution", de: "## Zusammenfassungsbudget dieses Laufs", en: "## This Run's Summary Budget" });
    const budgetText = pickPromptText(lang, {
      zh: `${factTitle}最多${factsBudget}字。${timelineTitle}最多${eventsBudget}字。`,
      ja: `${factTitle}は最大 ${factsBudget} 字。${timelineTitle}は最大 ${eventsBudget} 字。`,
      ko: `${factTitle} 최대 ${factsBudget}자. ${timelineTitle} 최대 ${eventsBudget}자.`,
      fr: `${factTitle} : ${factsBudget} mots max. ${timelineTitle} : ${eventsBudget} mots max.`,
      de: `${factTitle} max. ${factsWordBudget} Wörter. ${timelineTitle} max. ${eventsWordBudget} Wörter.`,
      en: `${factTitle} max ${factsWordBudget} words. ${timelineTitle} max ${eventsWordBudget} words.`,
    });
    const userContent = [
      hasPrev ? `${prevLabel}\n\n${prevSummary}` : "",
      `${newLabel}\n\n${convText}`,
      `${budgetLabel}\n\n${budgetText}`,
    ].filter(Boolean).join("\n\n");
    const layout = buildUtilityPromptLayout({
      cacheGroup: "memory.rolling_summary",
      templateVersion: "rolling-summary.v1",
      systemPrompt,
      userContent,
    });
    const usageContext = attachPromptLayoutMetadata({
      source: {
        subsystem: "memory",
        operation: "rolling_summary",
        surface: "system",
        trigger: opts.usageTrigger || "threshold",
      },
      attribution: {
        kind: "memory",
        agentId: resolvedModel.usageAgentId || null,
      },
    }, layout.usageMetadata);

    const maxTokens = withMemoryReasoningBuffer(visibleMaxTokens, resolvedModel);

    return callText({
      ...callTextConfigFromResolvedModel(resolvedModel),
      systemPrompt: layout.systemPrompt,
      messages: layout.messages,
      temperature: 0.3,
      maxTokens: maxTokens,
      timeoutMs: DEFAULT_CALL_TEXT_TIMEOUT_MS,
      signal: undefined,
      returnUsage: opts.returnUsage === true,
      usageLedger: resolvedModel.usageLedger,
      usageContext,
    });
  }

}

function normalizeSince(value) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function latestSince(...values) {
  let latest = null;
  for (const value of values) {
    const normalized = normalizeSince(value);
    if (!normalized) continue;
    if (!latest || Date.parse(normalized) > Date.parse(latest)) latest = normalized;
  }
  return latest;
}

function isAfter(value, since) {
  if (!value) return false;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  return ts > Date.parse(since);
}

function areMessagesAfter(messages, since) {
  if (!since) return true;
  return messages.every((message) => isAfter(message.timestamp, since));
}

function normalizeBranchProjection(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.lineage)) return null;
  if (typeof value.lineageHash !== "string" || !value.lineageHash) return null;
  return value;
}

function projectionCursor(projection) {
  return {
    coveredLeafId: projection.selectedLeafId ?? null,
    lineageHash: projection.lineageHash,
  };
}

function sameCursor(left, right) {
  if (!left || !right) return false;
  return (left.coveredLeafId ?? null) === (right.coveredLeafId ?? null)
    && left.lineageHash === right.lineageHash;
}

function projectionHashAtLeaf(projection, leafId) {
  if (leafId == null) return projection.rootLineageHash || null;
  return projection.prefixHashes?.[leafId] || null;
}

function isCursorAncestorOfProjection(cursor, projection) {
  if (!cursor || typeof cursor.lineageHash !== "string") return false;
  return projectionHashAtLeaf(projection, cursor.coveredLeafId ?? null) === cursor.lineageHash;
}

function projectionRemainsAncestor(original, latest) {
  return projectionHashAtLeaf(latest, original.selectedLeafId ?? null) === original.lineageHash;
}

function normalizeMemoryReflectionSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const pick = (key) => typeof value[key] === "string" ? value[key].trim() : "";
  return {
    agentName: pick("agentName"),
    userName: pick("userName"),
    identityAndPersonality: pick("identityAndPersonality"),
    userProfile: pick("userProfile"),
    existingMemory: pick("existingMemory"),
    roster: pick("roster"),
  };
}
