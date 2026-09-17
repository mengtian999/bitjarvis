#!/usr/bin/env node
/**
 * verify-poll-mode.mjs — AppService Poll 模式链路验证脚本（临时工具）
 *
 * 对一个运行中的 Tuwunel homeserver 逐步验证 P1 的四个关键假设：
 *   1. 虚拟用户注册：POST /register { type: "m.login.application_service" }
 *      （sender_localpart 匹配 exclusive 命名空间时免密）
 *   2. AS /sync：GET /sync?user_id=<虚拟用户> 用 as_token 长轮询成功
 *      （Matrix v1.13 规范允许，"MUST ... provide a user_id via the query string"）
 *   3. 代虚拟用户建房间 + 发消息：?user_id= 代发
 *   4. /sync 能收到该消息（Poll 链路闭环）
 *
 * 用法（先注册 AppService，拿到 asToken）：
 *   HOMESERVER_URL=http://127.0.0.1:8008 \
 *   AS_TOKEN=xxx \
 *   SENDER_LOCALPART=jarvis_home3f2a \
 *   [INVITE_USER=@alice:bitjarvis.chat] \
 *   node server/as-registrar/verify-poll-mode.mjs
 *
 * 可选先走注册服务（代替手工 admin room 命令）：
 *   REGISTRAR_URL=http://127.0.0.1:8797 REGISTRAR_TOKEN=... \
 *   NODE_ID=home3f2a [REGISTRATION_TOKEN=...] \
 *   + 上面的变量
 *
 * 全部 PASS 输出 exit 0；任一步 FAIL 输出 exit 1。
 */

const HOMESERVER_URL = (process.env.HOMESERVER_URL || "").replace(/\/+$/, "");
let AS_TOKEN = process.env.AS_TOKEN || "";
const SENDER_LOCALPART = process.env.SENDER_LOCALPART || "";
const INVITE_USER = process.env.INVITE_USER || "";
const REGISTRAR_URL = (process.env.REGISTRAR_URL || "").replace(/\/+$/, "");
const REGISTRAR_TOKEN = process.env.REGISTRAR_TOKEN || "";
const NODE_ID = process.env.NODE_ID || "";
const REGISTRATION_TOKEN = process.env.REGISTRATION_TOKEN || "";

const results = [];
function report(step, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
}

function api(path, { method = "GET", token = AS_TOKEN, userId, body } = {}) {
  const url = new URL(`${HOMESERVER_URL}${path}`);
  if (userId) url.searchParams.set("user_id", userId);
  return fetch(url.href, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function jsonOf(res) {
  const text = await res.text().catch(() => "");
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function main() {
  if (!HOMESERVER_URL || !AS_TOKEN || !SENDER_LOCALPART) {
    console.error("用法：HOMESERVER_URL=... AS_TOKEN=... SENDER_LOCALPART=... node server/as-registrar/verify-poll-mode.mjs");
    process.exit(1);
  }
  console.log(`homeserver: ${HOMESERVER_URL}`);
  console.log(`virtual user: @${SENDER_LOCALPART}:<server_name>\n`);

  // 步骤 0（可选）：走注册服务注册 AppService，拿到 fresh asToken
  if (REGISTRAR_URL && NODE_ID) {
    try {
      const res = await fetch(`${REGISTRAR_URL}/_jarvis/appservice/register`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REGISTRAR_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nodeId: NODE_ID,
          senderLocalpart: SENDER_LOCALPART,
          ...(REGISTRATION_TOKEN ? { registrationToken: REGISTRATION_TOKEN } : {}),
        }),
      });
      const payload = await jsonOf(res);
      if (res.ok && payload?.asToken) {
        AS_TOKEN = payload.asToken;
        report("0. 注册服务注册 AppService", true, `asToken=${String(payload.asToken).slice(0, 8)}…`);
      } else {
        report("0. 注册服务注册 AppService", false, `HTTP ${res.status}: ${payload?.detail || payload?.error || ""}`);
        return finish();
      }
    } catch (err) {
      report("0. 注册服务注册 AppService", false, err.message);
      return finish();
    }
  }

  const serverName = (() => {
    try { return new URL(HOMESERVER_URL).hostname; } catch { return "localhost"; }
  })();
  const virtualUser = `@${SENDER_LOCALPART}:${serverName}`;

  // 步骤 1：虚拟用户注册（m.login.application_service）
  try {
    const res = await api("/_matrix/client/v3/register", {
      method: "POST",
      body: { type: "m.login.application_service", username: SENDER_LOCALPART },
    });
    const payload = await jsonOf(res);
    if (res.ok && payload?.user_id) {
      report("1. 虚拟用户注册 (m.login.application_service)", true, `user_id=${payload.user_id}`);
    } else if (payload?.errcode === "M_USER_IN_USE") {
      report("1. 虚拟用户注册", true, "M_USER_IN_USE（已存在，视为通过）");
    } else {
      report("1. 虚拟用户注册", false, `HTTP ${res.status}: ${payload?.errcode || ""} ${payload?.error || ""}`);
      return finish();
    }
  } catch (err) {
    report("1. 虚拟用户注册", false, err.message);
    return finish();
  }

  // 步骤 2：AS 用 as_token + ?user_id= 走 /sync（timeout=0 快速返回）
  let nextBatch = null;
  try {
    const res = await api("/_matrix/client/v3/sync?timeout=0", { userId: virtualUser });
    const payload = await jsonOf(res);
    if (res.ok && payload?.next_batch) {
      nextBatch = payload.next_batch;
      report("2. AppService /sync (as_token + ?user_id=)", true, `next_batch=${String(nextBatch).slice(0, 16)}…`);
    } else {
      report("2. AppService /sync", false, `HTTP ${res.status}: ${payload?.errcode || ""} ${payload?.error || ""}`);
      return finish();
    }
  } catch (err) {
    report("2. AppService /sync", false, err.message);

async function step3And4({ virtualUser, nextBatch }) {
  // 步骤 3a：代虚拟用户创建房间（可选邀请 INVITE_USER）
  let roomId = null;
  try {
    const res = await api("/_matrix/client/v3/createRoom", {
      method: "POST",
      userId: virtualUser,
      body: {
        preset: "trusted_private_chat",
        is_direct: true,
        name: "jarvis-poll-verify",
        ...(INVITE_USER ? { invite: [INVITE_USER] } : {}),
      },
    });
    const payload = await jsonOf(res);
    roomId = payload?.room_id || null;
    if (res.ok && roomId) {
      report("3a. 代虚拟用户建房间（?user_id=）", true, roomId);
    } else {
      report("3a. 代虚拟用户建房间", false, `HTTP ${res.status}: ${payload?.errcode || ""} ${payload?.error || ""}`);
      return finish();
    }
  } catch (err) {
    report("3a. 代虚拟用户建房间", false, err.message);
    return finish();
  }

  // 步骤 3b：代虚拟用户发消息（?user_id= 代发）
  const testTxn = `verify-${Date.now().toString(36)}`;
  try {
    const res = await api(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${testTxn}`,
      {
        method: "PUT",
        userId: virtualUser,
        body: { msgtype: "m.text", body: "[jarvis verify] poll 模式链路验证消息" },
      },
    );
    const payload = await jsonOf(res);
    if (res.ok && payload?.event_id) {
      report("3b. 代虚拟用户发消息（?user_id=）", true, `event_id=${payload.event_id}`);
    } else {
      report("3b. 代虚拟用户发消息", false, `HTTP ${res.status}: ${payload?.errcode || ""} ${payload?.error || ""}`);
      return finish();
    }
  } catch (err) {
    report("3b. 代虚拟用户发消息", false, err.message);
    return finish();
  }

  // 步骤 4：再 /sync 确认能收到自己刚发的消息（Poll 链路闭环）
  try {
    const sinceParam = nextBatch ? `&since=${encodeURIComponent(nextBatch)}` : "";
    const res = await api(`/_matrix/client/v3/sync?timeout=5000${sinceParam}`, { userId: virtualUser });
    const payload = await jsonOf(res);
    const room = payload?.rooms?.join?.[roomId];
    const timeline = room?.timeline?.events || [];
    const received = timeline.some((e) => e?.type === "m.room.message" && e?.sender === virtualUser);
    if (res.ok && received) {
      report("4. /sync 收到代发消息（Poll 闭环）", true, `timeline=${timeline.length} 条`);
    } else {
      report("4. /sync 收到代发消息", false,
        res.ok ? "timeline 中未找到测试消息（可重跑确认增量时序）" : `HTTP ${res.status}: ${payload?.errcode || ""}`);
    }
  } catch (err) {
    report("4. /sync 收到代发消息", false, err.message);
  }

  finish();
}

function finish() {
  const pass = results.filter(Boolean).length;
  console.log(`\n结果：${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("fatal:", err.message || err);
  process.exit(1);
});

    return finish();
  }

  await step3And4({ virtualUser, nextBatch });
}

