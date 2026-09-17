/**
 * matrix-api.ts — 极简 Matrix Client-Server API 客户端（AppService 专用）
 *
 * 只封装本桥需要的 6 个端点：sync / join / send / typing / register / profile。
 *
 * 为什么不用 matrix-js-sdk（方案 §2.8 修订）：
 *   1. Bridge 出站纪律（#1612）：出站 REST 统一走 createBridgeOutboundHttp
 *      （代理路由 / 超时 / 重试 / 诊断标签），matrix-js-sdk 自带 HTTP 栈无法接入；
 *   2. AppService 用 /sync 必须带 ?user_id= 查询参数（Matrix v1.13 规范），
 *      SDK 对该参数的透传方式随版本漂移（方案原文亦标注"以 SDK 版本为准"）；
 *   3. 端点面积极小，手写实现可注入 fetchImpl 完全可测。
 *
 * 鉴权：Authorization: Bearer <as_token>（标准方式）。
 * 身份：代虚拟用户操作时按规范追加 ?user_id=<虚拟用户 MXID> 查询参数。
 */

import { createBridgeOutboundHttp } from "./outbound-http.ts";

export class MatrixApiError extends Error {
  declare errcode: string;
  declare status: number;

  constructor(message: string, fields: { errcode: string; status: number; cause?: unknown }) {
    super(message, fields.cause === undefined ? undefined : { cause: fields.cause });
    this.name = "MatrixApiError";
    this.errcode = fields.errcode;
    this.status = fields.status;
  }
}

/** /sync 之外的常规请求超时。 */
const DEFAULT_TIMEOUT_MS = 20_000;

export interface MatrixApi {
  platform: string;
  /** 长轮询 /sync。timeoutMs 是服务端挂起时长（ms），fetch 超时自动加 buffer。 */
  sync(args: { userId: string; since?: string | null; timeoutMs?: number; maxRetries?: number }): Promise<any>;
  joinRoom(args: { userId: string; roomId: string }): Promise<any>;
  sendMessage(args: { userId: string; roomId: string; txnId: string; content: Record<string, any> }): Promise<any>;
  sendTyping(args: { userId: string; roomId: string; typing?: boolean; timeoutMs?: number }): Promise<any>;
  /** AppService 注册虚拟用户（m.login.application_service，匹配命名空间即可免密）。 */
  registerApplicationServiceUser(args: { username: string }): Promise<any>;
  inviteToRoom(args: { userId: string; roomId: string; member: string }): Promise<any>;
  /**
   * 创建房间/Space（?user_id= 代 AppService 主身份）。非幂等——每次调用都会新建房间，
   * 调用方必须用已有 room_id 判断是否需要重建（避免重复创建 Space）。所以不发重试。
   */
  createRoom(args: {
    userId: string;
    name?: string;
    topic?: string;
    type?: "m.space" | "m.room";
    preset?: "private_chat" | "public_chat";
    invite?: string[];
    isDirect?: boolean;
    powerLevelContentOverride?: Record<string, any>;
  }): Promise<{ room_id: string }>;
  /** 查询展示名；未设置/查不到返回 null。 */
  getDisplayName(args: { userId: string }): Promise<string | null>;
  /** 设置虚拟用户展示名（?user_id= 代身份）。 */
  setDisplayName(args: { userId: string; displayname: string }): Promise<any>;
  /** 设置虚拟用户在线状态（presence: online/offline/unavailable）。 */
  setPresence(args: { userId: string; presence: string; statusMessage?: string }): Promise<any>;
  /** 发 state event（如 m.space.child 关联子房间）；?user_id= 代虚拟用户身份。 */
  sendStateEvent(args: { userId: string; roomId: string; eventType: string; stateKey?: string; content: Record<string, any> }): Promise<any>;
  /**
   * 上传媒体（二进制 Buffer）到 homeserver（/_matrix/media/v3/upload），返回 mxc:// content_uri。
   * ?user_id= 代虚拟用户身份。非幂等（每次上传生成新 media），不重试（同 #1612 发送类纪律）。
   */
  uploadMedia(args: { userId: string; filename?: string; mimeType: string; buffer: Buffer }): Promise<{ content_uri: string }>;
  /** 下载 mxc:// 媒体为 Buffer（mimeType 为 best-effort，调用方应以事件 info.mimetype 为准）。幂等，可重试。 */
  downloadMedia(mxcUri: string): Promise<{ buffer: Buffer; mimeType: string }>;
  /** 设置虚拟用户头像（PUT profile/<userId>/avatar_url，body { avatar_url }）。?user_id= 代身份。 */
  setAvatarUrl(args: { userId: string; avatarUrl: string }): Promise<any>;
}

export function createMatrixApi({
  homeserverUrl,
  accessToken,
  fetchImpl,
  platform = "matrix",
}: {
  homeserverUrl: string;
  accessToken: string;
  fetchImpl?: unknown;
  platform?: string;
}): MatrixApi {
  const base = String(homeserverUrl || "").trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error(`matrix api requires a valid http(s) homeserverUrl, got: "${homeserverUrl}"`);
  }
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("matrix api requires an accessToken (as_token)");
  }
  const http = createBridgeOutboundHttp({ platform, ...(fetchImpl ? { fetchImpl: fetchImpl as any } : {}) });

  function apiUrl(path: string, params: Record<string, unknown> | null = null): string {
    const url = new URL(base + path);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
      }
    }
    return url.href;
  }

  async function request({
    stage,
    url,
    method = "GET",
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    idempotent = false,
    maxRetries,
  }: {
    stage: string;
    url: string;
    method?: string;
    body?: Record<string, any>;
    timeoutMs?: number;
    idempotent?: boolean;
    maxRetries?: number;
  }): Promise<any> {
    const res: any = await http.request({
      stage,
      url,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      timeoutMs,
      idempotent,
      ...(maxRetries !== undefined ? { maxRetries } : {}),
    });
    const text = await res.text().catch(() => "");
    let payload: any = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!res.ok) {
      const errcode = String(payload?.errcode || `HTTP_${res.status}`);
      const detail = String(payload?.error || res.statusText || "request failed");
      throw new MatrixApiError(
        `[${stage}] matrix api error ${res.status}: ${errcode} ${detail}`,
        { errcode, status: res.status },
      );
    }
    return payload;
  }

  return { platform, sync, joinRoom, sendMessage, sendTyping, registerApplicationServiceUser, inviteToRoom, createRoom, getDisplayName, setDisplayName, setPresence, sendStateEvent, uploadMedia, downloadMedia, setAvatarUrl };


  async function sync({ userId, since, timeoutMs = 25_000, maxRetries = 1 }: {
    userId: string;
    since?: string | null;
    timeoutMs?: number;
    maxRetries?: number;
  }) {
    // GET 幂等；断线重试安全（失败时 since 游标未推进）。
    // fetch 超时必须大于服务端挂起时长，否则长轮询会被误判超时。
    return request({
      stage: "sync",
      url: apiUrl("/_matrix/client/v3/sync", { since, timeout: timeoutMs, user_id: userId }),
      timeoutMs: timeoutMs + 15_000,
      idempotent: true,
      maxRetries,
    });
  }

  async function joinRoom({ userId, roomId }: { userId: string; roomId: string }) {
    // 重复 join 幂等（已加入返回 200）。
    return request({
      stage: "join",
      url: apiUrl(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, { user_id: userId }),
      method: "POST",
      body: {},
      idempotent: true,
    });
  }

  async function sendMessage({ userId, roomId, txnId, content }: {
    userId: string;
    roomId: string;
    txnId: string;
    content: Record<string, any>;
  }) {
    // 带 txnId 的 PUT 在服务端按事务去重，自动重试不会产生重复消息，
    // 因此这里允许幂等重试（与其他平台"发送类绝不重试"不同，见 #1612 注）。
    return request({
      stage: "send_message",
      url: apiUrl(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
        { user_id: userId },
      ),
      method: "PUT",
      body: content,
      idempotent: true,
    });
  }

  async function sendTyping({ userId, roomId, typing = true, timeoutMs = 4000 }: {
    userId: string;
    roomId: string;
    typing?: boolean;
    timeoutMs?: number;
  }) {
    return request({
      stage: "typing",
      url: apiUrl(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`, { user_id: userId }),
      method: "PUT",
      body: typing ? { typing: true, timeout: timeoutMs } : { typing: false },
      timeoutMs: 10_000,
      idempotent: true,
    });
  }

  async function registerApplicationServiceUser({ username }: { username: string }) {
    // 非幂等：首次失败后是否已建号由服务端决定，交由调用方处理 M_USER_IN_USE。
    return request({
      stage: "register_user",
      url: apiUrl("/_matrix/client/v3/register"),
      method: "POST",
      body: { type: "m.login.application_service", username },
    });
  }

  async function inviteToRoom({ userId, roomId, member }: {
    userId: string;
    roomId: string;
    member: string;
  }) {
    // 邀请 member 进 roomId（以 AppService 伪身份 userId 操作）。
    // 已在房间的成员返回 M_ALREADY_IN_ROOM 等，由调用方按需忽略（补邀场景）。
    return request({
      stage: "invite_to_room",
      url: apiUrl(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, { user_id: userId }),
      method: "POST",
      body: { user_id: member },
    });
  }

  async function createRoom({ userId, name, topic, type, preset, invite, isDirect, powerLevelContentOverride }: {
    userId: string;
    name: string;
    topic?: string;
    type?: "m.space" | "m.room";
    preset?: "private_chat" | "public_chat";
    invite?: string[];
    isDirect?: boolean;
    powerLevelContentOverride?: Record<string, any>;
  }) {
    // 非幂等：每次调用都新建房间，绝不自动重试（同 #1612「发送类绝不重试」纪律，
    // 只是这里重试的风险是「重复建房间」而非「重复发消息」）。
    const payload: Record<string, any> = {
      ...(name ? { name } : {}),
      ...(topic ? { topic } : {}),
      // tuwunel 只认 creation_content.type（顶层 type 被忽略，实测建出普通房间而非 Space）
      ...(type ? { creation_content: { type } } : {}),
      preset: preset || "private_chat",
      ...(invite?.length ? { invite } : {}),
      ...(isDirect ? { is_direct: true } : {}),
      ...(powerLevelContentOverride ? { power_level_content_override: powerLevelContentOverride } : {}),
    };
    return request({
      stage: "create_room",
      url: apiUrl("/_matrix/client/v3/createRoom", { user_id: userId }),
      method: "POST",
      body: payload,
      idempotent: false,
      maxRetries: 0,
    });
  }

  async function getDisplayName({ userId }: { userId: string }): Promise<string | null> {
    const payload = await request({
      stage: "displayname",
      url: apiUrl(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`),
      timeoutMs: 10_000,
      idempotent: true,
      maxRetries: 0,
    });
    const name = payload?.displayname;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  }

  async function setDisplayName({ userId, displayname }: { userId: string; displayname: string }) {
    return request({
      stage: "set_displayname",
      url: apiUrl(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, { user_id: userId }),
      method: "PUT",
      body: { displayname },
      idempotent: true,
      maxRetries: 0,
    });
  }

  async function setPresence({ userId, presence, statusMessage }: { userId: string; presence: string; statusMessage?: string }) {
    return request({
      stage: "set_presence",
      url: apiUrl(`/_matrix/client/v3/presence/${encodeURIComponent(userId)}/status`, { user_id: userId }),
      method: "PUT",
      body: { presence, ...(statusMessage ? { status_msg: statusMessage } : {}) },
      idempotent: true,
      maxRetries: 0,
    });
  }

  async function sendStateEvent({ userId, roomId, eventType, stateKey, content }: {
    userId: string;
    roomId: string;
    eventType: string;
    stateKey?: string;
    content: Record<string, any>;
  }) {
    const key = stateKey ?? "";
    return request({
      stage: "send_state_event",
      url: apiUrl(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(key)}`, { user_id: userId }),
      method: "PUT",
      body: content,
      idempotent: true,
      maxRetries: 0,
    });
  }

  /**
   * 二进制安全请求（媒体上传 / 下载专用）。
   *
   * 与 request 的差异：body 原样透传（Buffer / Blob / 字符串，不走 JSON.stringify），
   * 响应不强制 JSON.parse。expect:"buffer" 返回 Buffer；expect:"json" 按 JSON 解析
   * （兼容 Matrix 错误体，仍抛 MatrixApiError{errcode,status} 供下游判断，如 M_USER_IN_USE）。
   * 复用 createBridgeOutboundHttp（#1612 出站纪律：代理 / 超时 / 重试 / 诊断标签全继承）。
   */
  async function requestRaw({
    stage,
    url,
    method = "GET",
    body,
    headers,
    timeoutMs,
    idempotent = false,
    maxRetries,
    expect = "json",
  }: {
    stage: string;
    url: string;
    method?: string;
    body?: any;
    headers?: Record<string, string>;
    timeoutMs?: number;
    idempotent?: boolean;
    maxRetries?: number;
    expect?: "json" | "buffer";
  }): Promise<any> {
    const res: any = await http.request({
      stage,
      url,
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(headers || {}) },
      body,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      idempotent,
      ...(maxRetries !== undefined ? { maxRetries } : {}),
    });
    const status = typeof res?.status === "number" ? res.status : 0;
    if (expect === "buffer") {
      if (status < 200 || status >= 300) {
        const errText = await res.text?.().catch(() => "") ?? "";
        let errcode = "M_HTTP_ERROR";
        if (errText) {
          try { const p = JSON.parse(errText); if (p?.errcode) errcode = p.errcode; } catch { /* non-JSON 错误体 */ }
        }
        throw new MatrixApiError(`[${platform}:${stage}] media request failed: HTTP ${status}`, { errcode, status, cause: errText || undefined });
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    }
    const text = await res.text?.().catch(() => "") ?? "";
    let payload: any = null;
    if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }
    if (status < 200 || status >= 300) {
      const errcode = payload?.errcode || "M_HTTP_ERROR";
      const message = payload?.error || `HTTP ${status}`;
      throw new MatrixApiError(`[${platform}:${stage}] ${message}`, { errcode, status, cause: payload ?? undefined });
    }
    return payload;
  }

  /** 上传媒体到 homeserver（/_matrix/media/v3/upload），返回 mxc:// content_uri。 */
  async function uploadMedia({ userId, filename, mimeType, buffer }: {
    userId: string;
    filename?: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ content_uri: string }> {
    const params: Record<string, unknown> = { user_id: userId };
    if (filename) params.filename = filename;
    const payload = await requestRaw({
      stage: "media_upload",
      url: apiUrl("/_matrix/media/v3/upload", params),
      method: "POST",
      headers: { "Content-Type": mimeType },
      body: buffer,
      idempotent: false,
      maxRetries: 0,
      expect: "json",
    });
    const contentUri = payload?.content_uri;
    if (typeof contentUri !== "string" || !contentUri) {
      throw new MatrixApiError(`[${platform}:media_upload] homeserver did not return content_uri`, { errcode: "M_INVALID_RESPONSE", status: 0 });
    }
    return { content_uri: contentUri };
  }

  /** 下载 mxc://<server>/<mediaId> 媒体为 Buffer（mimeType 为 best-effort）。 */
  async function downloadMedia(mxcUri: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const m = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxcUri || "");
    if (!m) {
      throw new MatrixApiError(`[${platform}:media_download] invalid mxc uri: ${mxcUri}`, { errcode: "M_INVALID_PARAM", status: 0 });
    }
    const buffer = await requestRaw({
      stage: "media_download",
      url: apiUrl(`/_matrix/media/v3/download/${encodeURIComponent(m[1])}/${m[2]}`, null),
      method: "GET",
      idempotent: true,
      maxRetries: 1,
      expect: "buffer",
    }) as Buffer;
    return { buffer, mimeType: "application/octet-stream" };
  }

  /** 设置虚拟用户头像（PUT profile/<userId>/avatar_url，body { avatar_url }）。复用 JSON request。 */
  async function setAvatarUrl({ userId, avatarUrl }: { userId: string; avatarUrl: string }) {
    return request({
      stage: "set_avatar_url",
      url: apiUrl(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/avatar_url`, { user_id: userId }),
      method: "PUT",
      body: { avatar_url: avatarUrl },
      idempotent: true,
      maxRetries: 0,
    });
  }
}
