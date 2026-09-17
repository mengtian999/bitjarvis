/**
 * handler.ts — as-registrar HTTP 请求处理（与 node:http 解耦，便于单测）
 *
 * POST /_jarvis/appservice/register
 *   Header: Authorization: Bearer <AS_REGISTRAR_TOKEN>
 *   Body:   { registrationToken?, nodeId, senderLocalpart? }
 *   → 校验 registrationToken（配置了 REGISTRATION_TOKEN 时强制）
 *   → 生成 registration YAML（as_token/hs_token 随机生成）
 *   → admin room 发送 !admin appservices register + ```yaml 围栏
 *   → 返回 { asToken, hsToken, senderLocalpart, homeserverUrl, registrationId }
 *
 * GET /healthz → { ok: true }
 */

import { buildAdminRegisterCommand, buildAdminUnregisterCommand, buildRegistration } from "./registration.ts";
import { sendAdminRoomMessage as defaultSendAdminRoomMessage } from "./admin-room.ts";
import type { AsRegistrarConfig } from "./config.ts";

const MAX_BODY_BYTES = 32 * 1024;

export interface RegistrarResponse {
  status: number;
  body: Record<string, unknown>;
}

function bearerToken(req: { headers: Map<string, string> | Record<string, string | undefined> }): string {
  const raw = req.headers instanceof Map
    ? (req.headers.get("authorization") || "")
    : (req.headers["authorization"] || "");
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : "";
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createAsRegistrarHandler({
  config,
  sendAdminRoomMessage = defaultSendAdminRoomMessage,
}: {
  config: AsRegistrarConfig;
  sendAdminRoomMessage?: typeof defaultSendAdminRoomMessage;
}) {
  return async function handleRequest(method: string, path: string, headers: any, rawBody: string): Promise<RegistrarResponse> {

    if (method === "GET" && (path === "/healthz" || path === "/healthz/")) {
      return { status: 200, body: { ok: true } };
    }

    if (method !== "POST" || (path !== "/_jarvis/appservice/register" && path !== "/_jarvis/appservice/register/")) {
      return { status: 404, body: { error: "M_UNRECOGNIZED", detail: "use POST /_jarvis/appservice/register" } };
    }

    const token = bearerToken({ headers });
    if (!token || !constantTimeEqual(token, config.registrarToken)) {
      return { status: 401, body: { error: "M_UNAUTHORIZED", detail: "missing or invalid bearer token" } };
    }

    if (rawBody.length > MAX_BODY_BYTES) {
      return { status: 413, body: { error: "M_TOO_LARGE", detail: "request body too large" } };
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      return { status: 400, body: { error: "M_BAD_JSON", detail: "request body is not valid JSON" } };
    }

    // registrationToken：Jarvis 首次绑定凭证（部署时通过 REGISTRATION_TOKEN 配置）
    if (config.registrationToken) {
      const presented = typeof payload?.registrationToken === "string" ? payload.registrationToken : "";
      if (!presented || !constantTimeEqual(presented, config.registrationToken)) {
        return { status: 403, body: { error: "M_FORBIDDEN", detail: "invalid registrationToken" } };
      }
    }

    if (typeof payload?.nodeId !== "string" || !payload.nodeId.trim()) {
      return { status: 400, body: { error: "M_MISSING_PARAM", detail: "nodeId is required" } };
    }

    // 输入校验（nodeId / senderLocalpart）：不合法直接 400，不进 admin-room 流程
    let built: ReturnType<typeof buildRegistration>;
    try {
      built = buildRegistration({
        nodeId: payload.nodeId,
        senderLocalpart: payload.senderLocalpart || null,
      });
    } catch (err: any) {
      return {
        status: 400,
        body: { error: "M_INVALID_PARAM", detail: err?.message || String(err) },
      };
    }

    try {
      const { registration, nodeSuffix, asToken, hsToken } = built;
      // tuwunel 的 appservices register 对已存在 id 报 "Duplicate id"（并非幂等替换）。
      // bind 是幂等重跑的（桌面端重启后自动 bind / 新 agent 补绑），所以先 unregister
      // 清掉同 id 的旧注册，再 register。admin room 命令按事件顺序串行执行，两条消息
      // 连发即可保证先后；unregister 失败（首次注册时该 id 不存在）不阻断。
      const unregisterCommand = buildAdminUnregisterCommand(registration.id);
      await sendAdminRoomMessage({
        homeserverUrl: config.homeserverUrl,
        accessToken: config.adminAccessToken,
        roomId: config.adminRoomId,
        text: unregisterCommand,
      }).catch(() => {
        // 首次注册时 id 不存在，tuwunel 会回错误事件——忽略
      });
      const command = buildAdminRegisterCommand(registration);
      const result = await sendAdminRoomMessage({
        homeserverUrl: config.homeserverUrl,
        accessToken: config.adminAccessToken,
        roomId: config.adminRoomId,
        text: command,
      });

      return {
        status: 200,
        body: {
          registrationId: registration.id,
          nodeSuffix,
          asToken,
          hsToken,
          senderLocalpart: registration.sender_localpart,
          homeserverUrl: config.homeserverUrl,
          adminEventId: result.eventId,
          // 重注册语义：先 unregister 同 id 旧注册（旧 as_token 随即失效）再 register
          note: "registered via admin room; stale same-id registration is unregistered first",
        },
      };
    } catch (err: any) {
      return {
        status: 502,
        body: { error: "M_UNKNOWN", detail: err?.message || String(err) },
      };
    }
  };
}
