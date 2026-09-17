/**
 * matrix-appservice-adapter.ts — Matrix AppService POLL 模式适配器
 *
 * 一个实例 = 一个 Agent 的一个虚拟用户（senderUserId，如 @jarvis_home3f2a:bitjarvis.chat）：
 *   - 用 as_token + ?user_id=<虚拟用户> 长轮询 /sync（Poll 模式，Matrix v1.13 规范允许：
 *     "Application services wishing to use /sync or /events ... MUST do so with a
 *     virtual user (provide a user_id via the query string)."）
 *   - 收到消息构造 sessionKey（mx_dm_/mx_group_ + @agentId）交给 BridgeManager（完全复用）
 *   - 回复时以虚拟用户身份代发（?user_id= 查询参数，exclusive 命名空间内 homeserver 允许代发）
 *
 * 结构仿 telegram-adapter.ts：工厂 + onMessage/onStatus 回调，工厂返回即启动 loop。
 */

import { createModuleLogger, debugLog } from "../debug-log.ts";
import { createMatrixApi } from "./matrix-api.ts";
import { localpartOf, parseVirtualUserId } from "./matrix-identity.ts";
import { createMediaCapabilities } from "./media-capabilities.ts";
import { detectMime } from "../file-metadata.ts";

const log = createModuleLogger("matrix");

/** 单条消息文本切分阈值（event size 上限 ~65KB，CJK 按 3 字节留裕量）。 */
const MAX_TEXT_CHARS = 20_000;
/** 事件去重容量（重连后 /sync 可能重放少量事件）。 */
const SEEN_EVENT_CAP = 1000;
/** 成员表跟踪房间数上限（粗 LRU 剪枝）。 */
const MAX_TRACKED_ROOMS = 300;
/** 展示名缓存上限。 */
const DISPLAY_NAME_CACHE_CAP = 200;
/** 连续失败多少次后上报 error 状态（期间保持重试）。 */
const ERROR_REPORT_THRESHOLD = 3;
/** Matrix AppService adapter 的媒体能力声明（供 BridgeManager / MediaDeliveryService 媒体投递路径探测）。
 *  必须与 createMediaCapabilities 契约一致（inputModes / supportedKinds / requiresReplyContext /
 *  deliveryByKind / source），否则 MediaDeliveryService 的 _assertKindSupported / _supportsInputMode
 *  探测不到字段而拒绝投递（报 "matrix does not support <kind> media delivery"）。
 *  matrix 走 buffer（sendMediaBuffer）与 local_file（sendMediaFile）两种入站模式，
 *  不实现 URL 直发（无 sendMedia），故不含 remote_url/public_url。 */
export const MATRIX_MEDIA_CAPABILITIES = createMediaCapabilities({
  platform: "matrix",
  inputModes: ["buffer", "local_file"],
  supportedKinds: ["image", "video", "audio", "document"],
  requiresReplyContext: false,
  deliveryByKind: {
    image: "native_image",
    video: "native_video",
    audio: "native_audio",
    document: "native_file",
  },
  /** 出站：可向 IM 发送图片 / 文件（sendMediaBuffer / sendMediaFile）。 */
  outboundMedia: true,
  /** 入站：可解析 IM 来的 m.image/m.file/m.video/m.audio 为 attachments（A3）。 */
  inboundMedia: true,
  /** 可按 mxc 引用下载媒体（downloadImage / downloadFileByRef）。 */
  downloadByRef: true,
  source: "lib/bridge/matrix-appservice-adapter.ts#MATRIX_MEDIA_CAPABILITIES",
});


function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 解析出站媒体的 MIME 类型。
 *
 * MediaDeliveryService 的调用契约是 `mime` 字段（telegram/wechat/qq adapter 都读
 * `metadata.mime`），本 adapter 的 sendMediaBuffer/sendMediaFile 曾只读 `mimeType`，
 * 导致真实 MIME 永远取不到、事件 info.mimetype 恒为 application/octet-stream。
 * IM 端（FluffyChat fork）用 info.mimetype 推导 MatrixFile.msgType：
 * octet-stream → m.file → detectFileType 不是 MatrixImageFile → MxcImage 永不渲染，
 * 聊天窗口只剩图片占位（图片其实已上传/发送成功）。
 *
 * 规则：显式 mimeType/mime 优先；显式值是 octet-stream 或缺失时，用
 * detectMime（magic bytes + 扩展名）嗅探兜底，最后才落 octet-stream。
 */
function resolveOutboundMimeType(
  options: Record<string, any>,
  buffer: Buffer,
  filename: string,
): string {
  const explicit = typeof options.mimeType === "string" && options.mimeType
    ? options.mimeType
    : (typeof options.mime === "string" && options.mime ? options.mime : "");
  if (explicit && explicit !== "application/octet-stream") return explicit;
  const sniffed = detectMime(buffer, "application/octet-stream", filename);
  if (sniffed && sniffed !== "application/octet-stream") return sniffed;
  return explicit || "application/octet-stream";
}

/**
 * @param {object} opts
 * @param {string} opts.homeserverUrl - Matrix CS API base（如 http://127.0.0.1:8008）
 * @param {string} opts.asToken - AppService 的 as_token（Authorization: Bearer）
 * @param {string} opts.senderUserId - 本 adapter 负责的虚拟用户 MXID
 * @param {string} [opts.agentId] - 绑定的 agent（sessionKey 的 @agentId 段）
 * @param {(msg: any) => void} [opts.onMessage]
 * @param {(status: string, error?: string) => void} [opts.onStatus]
 * @param {number} [opts.syncTimeoutMs] - /sync 服务端挂起时长
 * @param {Function} [opts.fetchImpl] - 测试注入
 */
export function createMatrixAppServiceAdapter({
  homeserverUrl,
  asToken,
  senderUserId,
  agentId,
  onMessage,
  onStatus,
  syncTimeoutMs = 25_000,
  fetchImpl,
  /** 重试退避基数（测试可调小；生产默认 1000ms，指数增长封顶 30s） */
  backoffBaseMs = 1000,
  /** /sync 网络层重试次数（默认 1；测试可置 0 关闭，见 matrix-api.sync） */
  syncMaxRetries = 1,
}: {
  homeserverUrl: string;
  asToken: string;
  senderUserId: string;
  agentId?: string | null;
  onMessage?: (msg: any) => void;
  onStatus?: (status: string, error?: string) => void;
  syncTimeoutMs?: number;
  fetchImpl?: unknown;
  backoffBaseMs?: number;
  syncMaxRetries?: number;
}) {
  const api = createMatrixApi({ homeserverUrl, accessToken: asToken, ...(fetchImpl ? { fetchImpl } : {}) });
  const myIdentity = parseVirtualUserId(senderUserId);
  const myNodeSuffix = myIdentity?.nodeSuffix || null;

  let stopped = false;
  let since: string | null = null;
  let firstSyncDone = false;
  let errorReported = false;
  let consecutiveErrors = 0;
  let backoffMs = backoffBaseMs;
  let txnCounter = 0;

  /** roomId → (userId → membership)，由 sync 增量维护 */
  const roomMembers = new Map<string, Map<string, string>>();
  const roomLastActive = new Map<string, number>();
  const seenEventIds = new Set<string>();
  const seenEventOrder: string[] = [];
  const displayNameCache = new Map<string, string>();
  const encryptedWarnedRooms = new Set<string>();

  function touchRoom(roomId: string) {
    roomLastActive.set(roomId, Date.now());
    if (roomMembers.size > MAX_TRACKED_ROOMS) {
      let oldestId: string | null = null;
      let oldestTs = Infinity;
      for (const [id, ts] of roomLastActive) {
        if (ts < oldestTs) { oldestTs = ts; oldestId = id; }
      }
      if (oldestId) {
        roomMembers.delete(oldestId);
        roomLastActive.delete(oldestId);
      }
    }
  }

  function trackMember(roomId: string, userId: string, membership: unknown) {
    if (!roomId || !userId) return;
    let map = roomMembers.get(roomId);
    if (!map) {
      map = new Map();
      roomMembers.set(roomId, map);
    }
    if (membership === "join" || membership === "invite") map.set(userId, String(membership));
    else map.delete(userId);
    touchRoom(roomId);
  }

  function isGroupRoom(roomId: string) {
    return (roomMembers.get(roomId)?.size ?? 0) > 2;
  }

  function rememberEvent(eventId: string) {
    if (seenEventIds.has(eventId)) return false;
    seenEventIds.add(eventId);
    seenEventOrder.push(eventId);
    if (seenEventOrder.length > SEEN_EVENT_CAP) {
      const dropped = seenEventOrder.splice(0, seenEventOrder.length - SEEN_EVENT_CAP);
      for (const id of dropped) seenEventIds.delete(id);
    }
    return true;
  }

  async function loop() {
    debugLog()?.log("bridge", `[matrix] poll loop start user=${senderUserId}`);
    while (!stopped) {
      try {
        const data = await api.sync({ userId: senderUserId, since, timeoutMs: syncTimeoutMs, maxRetries: syncMaxRetries });
        consecutiveErrors = 0;
        backoffMs = backoffBaseMs;
        since = typeof data?.next_batch === "string" && data.next_batch ? data.next_batch : since;
        await processSyncResponse(data);
        if (!firstSyncDone || errorReported) {
          firstSyncDone = true;
          errorReported = false;
          onStatus?.("connected");
        }
      } catch (err) {
        if (stopped) return;
        consecutiveErrors += 1;
        const message = err?.message || String(err);
        log.error(`sync error (${consecutiveErrors}): ${message}`);
        debugLog()?.warn("bridge", `[matrix] sync error (${consecutiveErrors}): ${message}`);
        if (consecutiveErrors >= ERROR_REPORT_THRESHOLD && !errorReported) {
          errorReported = true;
          onStatus?.("error", message);
        }
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  }

  async function processSyncResponse(data: any) {
    // 被邀请的房间：虚拟用户必须主动 join（DM 由用户侧发起创建）
    const invite = data?.rooms?.invite || {};
    for (const [roomId, bundle] of Object.entries<any>(invite)) {
      let invitedMe = false;
      for (const event of bundle?.invite_state?.events || []) {
        if (event?.type === "m.room.member" && typeof event.state_key === "string") {
          trackMember(roomId, event.state_key, event.content?.membership);
          if (event.state_key === senderUserId && event.content?.membership === "invite") invitedMe = true;
        }
      }
      if (invitedMe) {
        try {
          await api.joinRoom({ userId: senderUserId, roomId });
          debugLog()?.log("bridge", `[matrix] joined invited room ${roomId}`);
        } catch (err: any) {
          log.error(`join ${roomId} failed: ${err?.message || err}`);
        }
      }
    }

    const join = data?.rooms?.join || {};
    for (const [roomId, bundle] of Object.entries<any>(join)) {
      for (const event of bundle?.state?.events || []) applyStateEvent(roomId, event, false);
      for (const event of bundle?.timeline?.events || []) await applyStateEvent(roomId, event, true);
    }
  }


  async function applyStateEvent(roomId: string, event: any, isTimeline: boolean) {
    if (!event || typeof event !== "object") return;
    touchRoom(roomId);
    if (event.type === "m.room.member" && typeof event.state_key === "string") {
      trackMember(roomId, event.state_key, event.content?.membership);
      return;
    }
    if (!isTimeline) return;
    if (event.type === "m.room.encrypted") {
      // P1 不做 E2E（方案 §9.6）：提示房间需要保持明文
      if (!encryptedWarnedRooms.has(roomId)) {
        encryptedWarnedRooms.add(roomId);
        log.warn(`room ${roomId} 收到加密事件：P1 不支持 E2E，请保持该房间为明文`);
      }
      return;
    }
    if (event.type !== "m.room.message") return;
    await handleRoomMessage(roomId, event);
  }

  async function handleRoomMessage(roomId: string, event: any) {
    const eventId = typeof event.event_id === "string" ? event.event_id : "";
    const sender = event.sender;
    const content = event.content || {};

    // 重连后 /sync 重放去重
    if (eventId && !rememberEvent(eventId)) return;
    // 自己的回显
    if (!sender || sender === senderUserId) return;
    // 同节点其他虚拟用户（如 @assistant_home3f2a）的发言按回显跳过，
    // 避免同一节点的多 Agent 在共享房间互回成死循环
    if (myNodeSuffix && parseVirtualUserId(sender)?.nodeSuffix === myNodeSuffix) return;
    // 编辑事件（rel_type=m.replace）按新消息处理会重复，跳过
    if (content["m.relates.to"]?.rel_type === "m.replace") return;

    const text = contentToText(content);
    if (!text) return;

    // A3：媒体消息解析为附件对象（image/video/audio/file），交由 bridge-manager
    // _resolveAttachments 经 platformRef → adapter.downloadImage/downloadFileByRef
    // 下载并物化为 inboundFiles，agent 才能真正看到图片/文件。占位文本保留。
    const mediaAttachments = matrixInboundAttachments(content, eventId);

    const displayName = await resolveDisplayName(sender);
    const isGroup = isGroupRoom(roomId);

    try {
      await onMessage?.({
        sessionKey: `mx_${isGroup ? "group" : "dm"}_${roomId}@${agentId}`,
        chatId: roomId,
        userId: sender,
        principalId: sender,
        displayName,
        senderName: displayName,
        avatarUrl: null,
        text,
        ...(mediaAttachments.length ? { attachments: mediaAttachments } : {}),
        isGroup,
        agentId: agentId || null,
        _msgId: eventId || null,
      });
    } catch (err: any) {
      // onMessage 失败不能打断 sync loop（消息处理有自身的 pending 队列）
      log.error(`onMessage failed: ${err?.message || err}`);
    }
  }

  /** Matrix 富回复 fallback：正文前的 "> <@user> ..." 引用行去掉。 */
  function stripReplyFallback(body: string) {
    if (!body) return "";
    const lines = body.split("\n");
    let i = 0;
    while (i < lines.length && lines[i].startsWith("> ")) i += 1;
    if (i === 0) return body;
    while (i < lines.length && lines[i] === "") i += 1;
    return lines.slice(i).join("\n") || body;
  }

  /** 把 Matrix 媒体消息（m.image/m.file/m.video/m.audio）转成 bridge 附件对象。
   *  形状与 bridge-manager._resolveAttachments 的消费契约对齐：
   *  type / filename / mimeType / size / platformRef / _messageId；platformRef={mxc,...}
   *  供 adapter.downloadImage / downloadFileByRef 下载。无 mxc url 时返回 []
   *  （保持占位文本行为，消息不静默丢失）。
   */
  function matrixInboundAttachments(content: any, eventId: string) {
    const mxc = typeof content?.url === "string" && content.url.startsWith("mxc://") ? content.url : "";
    if (!mxc) return [];
    const info = content.info && typeof content.info === "object" ? content.info : {};
    const filename = typeof content.body === "string" && content.body ? content.body : (mxc.split("/").pop() || "file");
    const mimeType = typeof info.mimetype === "string" ? info.mimetype : undefined;
    const type = content.msgtype === "m.image" ? "image"
      : content.msgtype === "m.video" ? "video"
        : content.msgtype === "m.audio" ? "audio"
          : "file";
    return [{
      type,
      filename,
      ...(mimeType ? { mimeType } : {}),
      ...(typeof info.size === "number" ? { size: info.size } : {}),
      platformRef: { mxc, ...(mimeType ? { mimeType } : {}), filename },
      _messageId: eventId || null,
    }];
  }

  function contentToText(content: any) {
    const body = typeof content.body === "string" ? content.body : "";
    switch (content.msgtype) {
      case "m.text":
      case "m.notice":
        return stripReplyFallback(body);
      case "m.emote":
        return stripReplyFallback(body ? `* ${body}` : "");
      // P1 媒体不做下载（MediaDeliveryService 接入在 P3）：转成可读占位文本，消息不静默丢失
      case "m.image": return body ? `[图片] ${body}` : "[图片]";
      case "m.file": return body ? `[文件] ${body}` : "[文件]";
      case "m.video": return body ? `[视频] ${body}` : "[视频]";
      case "m.audio": return body ? `[语音] ${body}` : "[语音]";
      case "m.location": return body ? `[位置] ${body}` : "[位置]";
      default:
        return body;
    }
  }

  async function resolveDisplayName(userId: string) {
    const cached = displayNameCache.get(userId);
    if (cached !== undefined) return cached;
    let name: string | null = null;
    try {
      name = await api.getDisplayName({ userId });
    } catch {
      name = null;
    }
    const resolved = name || localpartOf(userId) || userId;
    if (displayNameCache.size >= DISPLAY_NAME_CACHE_CAP) {
      const first = displayNameCache.keys().next().value;
      if (first !== undefined) displayNameCache.delete(first);
    }
    displayNameCache.set(userId, resolved);
    return resolved;
  }

  function nextTxnId() {
    txnCounter += 1;
    return `jarvis-${Date.now().toString(36)}-${txnCounter}`;
  }

  /** chatId 兼容两种形态：roomId（!开头）原样；owner userId（@开头）→ 查找双方 DM 房间。 */
  function resolveRoomId(chatId: unknown) {
    const value = typeof chatId === "string" ? chatId.trim() : "";
    if (!value) return null;
    if (value.startsWith("!")) return value;
    if (value.startsWith("@")) {
      for (const [roomId, members] of roomMembers) {
        if (members.size === 2 && members.has(value) && members.has(senderUserId)) return roomId;
      }
      return null;
    }
    return null;
  }

  function chunkText(text: string) {
    if (text.length <= MAX_TEXT_CHARS) return [text];
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > MAX_TEXT_CHARS) {
      let cut = rest.lastIndexOf("\n", MAX_TEXT_CHARS);
      if (cut < MAX_TEXT_CHARS / 2) cut = MAX_TEXT_CHARS;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) chunks.push(rest);
    return chunks;
  }

  async function sendReply(chatId: string, text: string, _options: Record<string, any> = {}) {
    const roomId = resolveRoomId(chatId);
    if (!roomId) throw new Error(`[matrix] 无法解析回复目标房间: ${chatId}`);
    const body = typeof text === "string" ? text : String(text ?? "");
    for (const chunk of chunkText(body)) {
      await api.sendMessage({
        userId: senderUserId,
        roomId,
        txnId: nextTxnId(),
        content: { msgtype: "m.text", body: chunk },
      });
    }
  }

  async function sendTypingIndicator(chatId: string, options: Record<string, any> = {}) {
    const roomId = resolveRoomId(chatId);
    if (!roomId) return;
    try {
      await api.sendTyping({
        userId: senderUserId,
        roomId,
        typing: true,
        timeoutMs: typeof options.timeoutMs === "number" ? options.timeoutMs : 4000,
      });
    } catch {
      // typing 指示失败静默（telegram 同款处理）
    }
  }

  /** 主动通知路径（sendProactive）用：owner userId → DM roomId；找不到返回 null。 */
  function resolveOwnerChatId(ownerId: string) {
    return resolveRoomId(ownerId);
  }

  function getMe() {
    // 静态身份；as_token 有效性由 sync loop 的 connected/error 状态体现
    return { user_id: senderUserId, agent_id: agentId || null };
  }

  function stop() {
    stopped = true;
  }

  loop().catch((err: any) => {
    // loop 内部已兜底，这里防未捕获异常逃逸
    log.error(`poll loop crashed: ${err?.message || err}`);
    onStatus?.("error", err?.message || String(err));
  });

  /**
   * 发送图片 / 文件到 IM 聊天窗口（A 出站方向）。
   * 先 uploadMedia 上传 Buffer 到 homeserver 拿 mxc:// content_uri，再以 m.image / m.file 消息发出。
   * 非幂等（每次上传生成新 media），不重试——避免重复上传 / 重复发送（同 #1612 发送类纪律）。
   */
  async function sendMediaBuffer(chatId: string, buffer: Buffer, options: Record<string, any> = {}) {
    const roomId = resolveRoomId(chatId);
    if (!roomId) throw new Error(`[matrix] 无法解析媒体发送目标房间: ${chatId}`);
    const filename = typeof options.filename === "string" && options.filename
      ? options.filename
      : (options.kind === "image" ? "image" : "file");
    const mimeType = resolveOutboundMimeType(options, buffer, filename);
    const msgtype = options.kind === "image" ? "m.image" : "m.file";
    const { content_uri } = await api.uploadMedia({ userId: senderUserId, filename, mimeType, buffer });
    await api.sendMessage({
      userId: senderUserId,
      roomId,
      txnId: nextTxnId(),
      content: {
        msgtype,
        body: filename,
        url: content_uri,
        info: { mimetype: mimeType, size: buffer.length },
      },
    });
  }

  /** 从本地文件路径读取字节后作为图片 / 文件发送。 */
  async function sendMediaFile(chatId: string, filePath: string, options: Record<string, any> = {}) {
    const { readFileSync } = await import("node:fs");
    const buffer = readFileSync(filePath);
    const filename = typeof options.filename === "string" && options.filename
      ? options.filename
      : (filePath.split(/[\\/]/).pop() || (options.kind === "image" ? "image" : "file"));
    const mimeType = resolveOutboundMimeType(options, buffer, filename);
    return sendMediaBuffer(chatId, buffer, {
      mimeType,
      filename,
      ...(options.kind ? { kind: options.kind } : {}),
    });
  }

  /**
   * 按 mxc 引用下载图片为 Buffer（供 agent 侧读取 IM 用户发来的图片）。
   * @param ref { mxc: string, mimeType?: string, filename?: string }
   */
  async function downloadImage(ref: { mxc: string; mimeType?: string; filename?: string }) {
    const { buffer, mimeType } = await api.downloadMedia(ref.mxc);
    return {
      buffer,
      mimeType: ref.mimeType || mimeType,
      filename: ref.filename || "image",
    };
  }

  /** 按引用下载文件（与 downloadImage 同实现，语义别名）。 */
  async function downloadFileByRef(ref: { mxc: string; mimeType?: string; filename?: string }) {
    return downloadImage(ref);
  }


  return {
    platform: "matrix",
    senderUserId,
    sendReply,
    sendBlockReply: sendReply,
    sendTypingIndicator,
    resolveOwnerChatId,
    getMe,
    stop,
    sendMediaBuffer,
    sendMediaFile,
    downloadImage,
    downloadFileByRef,
    mediaCapabilities: MATRIX_MEDIA_CAPABILITIES,
  };
}
