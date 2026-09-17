/**
 * admin-room.ts — 用 admin 账号向 Tuwunel admin room 发送注册命令
 *
 * 全程标准 Matrix Client-Server API（发消息），无私有 Admin API 依赖。
 * 使用全局 fetch（Node 24 内建），保持独立服务零依赖。
 */

export interface AdminRoomSendResult {
  eventId: string | null;
}

export async function sendAdminRoomMessage({
  homeserverUrl,
  accessToken,
  roomId,
  text,
  fetchImpl = globalThis.fetch,
}: {
  homeserverUrl: string;
  accessToken: string;
  roomId: string;
  text: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<AdminRoomSendResult> {
  const base = homeserverUrl.replace(/\/+$/, "");
  const txnId = `jarvis-registrar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const url = `${base}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ msgtype: "m.text", body: text }),
    });
  } catch (err: any) {
    throw new Error(`admin room message network error: ${err?.message || err}`);
  }

  const bodyText = await res.text().catch(() => "");
  let payload: any = null;
  if (bodyText) {
    try { payload = JSON.parse(bodyText); } catch { payload = null; }
  }

  if (!res.ok) {
    const errcode = String(payload?.errcode || `HTTP_${res.status}`);
    const detail = String(payload?.error || res.statusText || "request failed");
    throw new Error(`admin room message failed: ${errcode} ${detail}`);
  }

  const eventId = typeof payload?.event_id === "string" ? payload.event_id : null;
  return { eventId };
}
