/**
 * matrix-bind.ts — Matrix IM 绑定 REST API（P2）
 *
 * 桌面端 ImView 监听到 FluffyChat 登录成功（postMessage matrix-credentials）后调用
 * POST /api/bridge/matrix/bind，本路由完成方案 §4.1 的绑定流程：
 *
 *   1. 调 bitjarvis.chat 侧 as-registrar（P1，server/as-registrar）注册本节点 AppService
 *      （每 agent 终端一个，tuwunel admin room 热注册）；
 *   2. 把 as_token / 虚拟用户身份 / owner 写入每个 agent 的 config.bridge.matrix；
 *   3. 为每个 agent 注册虚拟用户（m.login.application_service，无需密码）；
 *   4. 启动 Matrix AppService Adapter（BridgeManager.startPlatformFromConfig）。
 *
 * 环境变量（Jarvis 侧，与 as-registrar/README.md 校验脚本同源命名）：
 *   REGISTRAR_URL     as-registrar 基址（如 http://127.0.0.1:8797）
 *   REGISTRAR_TOKEN   as-registrar 的 Bearer 鉴权令牌（AS_REGISTRAR_TOKEN）
 */

import { Hono } from "hono";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { safeJson } from "../hono-helpers.ts";
import { debugLog } from "../../lib/debug-log.ts";
import { createBridgeOutboundHttp } from "../../lib/bridge/outbound-http.ts";
import { createMatrixApi, MatrixApiError } from "../../lib/bridge/matrix-api.ts";
import { denyWithoutScope } from "../http/capability-guard.ts";

/** serverNodeId（server_<uuid>）→ 8 位小写字母/数字节点后缀的确定性派生。 */
const NODE_SUFFIX_LEN = 8;
const NODE_SUFFIX_RE = /^[a-z0-9]{8}$/;

/**
 * 从 serverNodeId 派生 nodeSuffix。
 *
 * 实际节点 id 形如 `server_<uuid>`（core/server-identity.ts），前 8 位含下划线，
 * 过不了 as-registrar 的 `^[a-z0-9]{8}$` 校验。这里剥掉 `server_` 前缀、滤掉
 * uuid 里的连字符后取前 8 位 hex（uuid 唯一 ⇒ 前缀确定且跨节点大概率唯一）。
 *
 * 兜底：若派生结果不足 8 位，回退到整串 id 的 sha256 hex 前 8 位。
 */
export function nodeSuffixForServerNodeId(serverNodeId: unknown): string {
  const raw = typeof serverNodeId === "string" ? serverNodeId.trim() : "";
  if (!raw) throw new Error("serverNodeId 缺失，无法派生 matrix 节点后缀");
  const withoutPrefix = raw.replace(/^[a-z]+_/i, "");
  const alnum = withoutPrefix.replace(/[^a-z0-9]/gi, "").toLowerCase();
  let suffix = alnum.slice(0, NODE_SUFFIX_LEN);
  if (!NODE_SUFFIX_RE.test(suffix)) {
    const hex = createHash("sha256").update(raw).digest("hex");
    suffix = hex.slice(0, NODE_SUFFIX_LEN);
  }
  if (!NODE_SUFFIX_RE.test(suffix)) {
    throw new Error(`无法从 serverNodeId 派生合法 nodeSuffix: "${serverNodeId}"`);
  }
  return suffix;
}

/** homeserverUrl → Matrix server name（host，含端口）。 */
export function serverNameFromUrl(homeserverUrl: unknown): string {
  const raw = typeof homeserverUrl === "string" ? homeserverUrl.trim().replace(/\/+$/, "") : "";
  if (!raw) throw new Error("homeserverUrl 缺失");
  let host: string;
  try {
    host = new URL(raw).host;
  } catch {
    throw new Error(`homeserverUrl 不是合法 http(s) URL: "${homeserverUrl}"`);
  }
  if (!host) throw new Error(`homeserverUrl 无法解析出 host: "${homeserverUrl}"`);
  return host;
}

/** agentId → Matrix user localpart（小写 + 合法字符校验），不合法返回空串。 */
export function sanitizeAgentLocalpart(agentId: unknown): string {
  const raw = typeof agentId === "string" ? agentId.trim().toLowerCase() : "";
  if (!raw) return "";
  if (!/^[a-z0-9._=+/-]{1,64}$/.test(raw)) return "";
  return raw;
}

/** agent 头像扩展名 → MIME（与 agent-manager 的 avatar 目录约定一致）。 */
const AVATAR_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const AGENT_AVATAR_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

/**
 * 解析 agent 头像文件（<agentsDir>/<agentId>/avatars/agent.<ext>，与
 * agent-manager.readAgentAvatarState 同一目录约定；agentsDir = jarvisHome/agents，
 * 见 engine.ts 构造）。返回 { filename, mimeType, buffer }；无头像/引擎缺 agentsDir 返回 null。
 */
export function resolveAgentAvatarFile(engine: any, agentId: string) {
  const agentsDir = typeof engine?.agentsDir === "string" && engine.agentsDir ? engine.agentsDir : "";
  if (!agentsDir) return null;
  for (const ext of AGENT_AVATAR_EXTENSIONS) {
    const avatarPath = path.join(agentsDir, agentId, "avatars", `agent.${ext}`);
    try {
      return {
        filename: `agent.${ext}`,
        mimeType: AVATAR_MIME_BY_EXT[ext] || "application/octet-stream",
        buffer: readFileSync(avatarPath),
      };
    } catch {
      // 该扩展名无头像，尝试下一个
    }
  }
  return null;
}

/**
 * 解析用于 Matrix 虚拟用户展示名的 agent 显示名。
 * 优先取 config.yaml 里的 persona 名（agent.config.agent.name，用户可配置为中文昵称）；
 * 退化到 Agent 对象上的 name（通常是英文 agentId）；最终退化到 agentId。
 */
export function resolveAgentDisplayName(agent: any, agentId: string) {
  const cfgName = typeof agent?.config?.agent?.name === "string" ? agent.config.agent.name.trim() : "";
  if (cfgName) return cfgName;
  const objName = typeof agent?.name === "string" ? agent.name.trim() : "";
  if (objName) return objName;
  return agentId;
}

/**
 * 把单个 agent 的 displayname + avatar 重同步到其 Matrix 虚拟用户。
 * 与 bind 时的初始同步（C1 displayname / C2 avatar）同一套逻辑；改名 / 换头像后
 * 由 agents 路由 fire-and-forget 调用，也可由 POST /bridge/matrix/refresh-profile 显式触发。
 *
 * 仅当该 agent 已绑定 matrix（config.bridge.matrix.{enabled,senderUserId,homeserverUrl,asToken}
 * 齐全）才真正执行；否则返回 reason="not-bound"，调用方可静默跳过。
 *
 * @param engine    Jarvis engine（取 agentsDir / getAgent）
 * @param agentId   目标 agent
 * @param fetchImpl 可选出站 fetch；refresh-profile 路由传 outboundHttp，agents 路由不传则用全局 fetch
 * @returns { ok, results, reason? }
 */
export async function syncMatrixProfileForAgent(
  engine: any,
  agentId: string,
  fetchImpl?: any,
): Promise<{ ok: boolean; results: Record<string, { ok: boolean; error?: string; skipped?: string }>; reason?: string }> {
  const agent = agentId ? engine?.getAgent?.(agentId) : null;
  const cfg = agent?.config?.bridge?.matrix;
  if (!agent || !cfg?.enabled || !cfg?.senderUserId || !cfg?.homeserverUrl || !cfg?.asToken) {
    return { ok: false, results: {}, reason: "not-bound" };
  }
  const api = createMatrixApi({
    homeserverUrl: cfg.homeserverUrl,
    accessToken: cfg.asToken,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const results: Record<string, { ok: boolean; error?: string; skipped?: string }> = {};
  const agentName = resolveAgentDisplayName(agent, agentId);
  try {
    await api.setDisplayName({ userId: cfg.senderUserId, displayname: agentName });
    results.displayname = { ok: true };
  } catch (err: any) {
    results.displayname = { ok: false, error: err?.message || String(err) };
  }
  try {
    const avatar = resolveAgentAvatarFile(engine, agentId);
    if (avatar) {
      const { content_uri } = await api.uploadMedia({
        userId: cfg.senderUserId,
        filename: avatar.filename,
        mimeType: avatar.mimeType,
        buffer: avatar.buffer,
      });
      await api.setAvatarUrl({ userId: cfg.senderUserId, avatarUrl: content_uri });
      results.avatar = { ok: true };
    } else {
      results.avatar = { ok: true, skipped: "no-avatar-file" };
    }
  } catch (err: any) {
    results.avatar = { ok: false, error: err?.message || String(err) };
  }
  return { ok: !!(results.displayname?.ok && results.avatar?.ok), results };
}

/**
 * 删除 agent 时把其 Matrix 虚拟用户下线：停 adapter（stopPlatform）+ presence offline。
 *
 * Matrix 用户一旦注册不可删除；DM 房间成员关系 leave 需 roomId，而 cfg 未持久化
 * roomId（adapter 运行时才解析），故这里只做"下线"——IM 端该虚拟用户立即变离线、
 * 不再出现在在线列表。cfg 必须在 deleteAgent 之前捕获（删除后 getAgent 返回 null）。
 *
 * @param manager   BridgeManager（stopPlatform；可为 null）
 * @param agentId   目标 agent
 * @param cfg       删除前捕获的 config.bridge.matrix（需 senderUserId/homeserverUrl/asToken）
 * @param fetchImpl 可选出站 fetch
 */
export async function deactivateMatrixProfileForAgent(
  manager: any,
  agentId: string,
  cfg: any,
  fetchImpl?: any,
): Promise<{ ok: boolean; error?: string }> {
  try {
    manager?.stopPlatform?.("matrix", agentId);
  } catch (err: any) {
    debugLog()?.warn("api", `[matrix] stopPlatform on delete (${agentId}) 失败: ${err?.message || err}`);
  }
  if (!cfg?.senderUserId || !cfg?.homeserverUrl || !cfg?.asToken) {
    return { ok: false, error: "missing matrix cfg fields" };
  }
  try {
    const api = createMatrixApi({
      homeserverUrl: cfg.homeserverUrl,
      accessToken: cfg.asToken,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    await api.setPresence({ userId: cfg.senderUserId, presence: "offline" });
    return { ok: true };
  } catch (err: any) {
    debugLog()?.warn("api", `[matrix] setPresence offline on delete (${agentId}) 失败: ${err?.message || err}`);
    return { ok: false, error: err?.message || String(err) };
  }
}

export interface MatrixRegistrarConfig {
  registrarUrl: string;
  registrarToken: string;
}

/**
 * 打包后的桌面端没有环境变量入口，as-registrar 的连接地址/令牌需可由用户在
 * 设置里填写并持久化。这里落到 {JARVIS_HOME}/matrix-registrar.json，bind 时
 * env 优先、缺失则回退该文件，live 生效（写入后下一次 bind/status 即可读到，
 * 无需重启 server）。
 */
const REGISTRAR_CONFIG_FILENAME = "matrix-registrar.json";

/** 读取 as-registrar 连接配置；缺任一必填项返回 null（未配置）。 */
export function loadMatrixRegistrarConfig(env: Record<string, string | undefined> = process.env): MatrixRegistrarConfig | null {
  const registrarUrl = (env["REGISTRAR_URL"] || "").trim();
  const registrarToken = (env["REGISTRAR_TOKEN"] || "").trim();
  if (!registrarUrl || !registrarToken || !/^https?:\/\//i.test(registrarUrl)) return null;
  return { registrarUrl: registrarUrl.replace(/\/+$/, ""), registrarToken };
}

/** 校验一对 url/token 是否合法（http(s) + 非空 token）。 */
function validateRegistrarPair(registrarUrl: string, registrarToken: string): MatrixRegistrarConfig | null {
  const url = (registrarUrl || "").trim();
  const token = (registrarToken || "").trim();
  if (!url || !token || !/^https?:\/\//i.test(url)) return null;
  return { registrarUrl: url.replace(/\/+$/, ""), registrarToken: token };
}

/** 从 {JARVIS_HOME}/matrix-registrar.json 读取持久化配置；不存在/非法返回 null。 */
export function loadPersistedRegistrarConfig(jarvisHome: unknown): MatrixRegistrarConfig | null {
  if (typeof jarvisHome !== "string" || !jarvisHome) return null;
  let raw: string;
  try {
    raw = readFileSync(path.join(jarvisHome, REGISTRAR_CONFIG_FILENAME), "utf8");
  } catch {
    return null;
  }
  let obj: any = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  return validateRegistrarPair(obj.registrarUrl, obj.registrarToken);
}

/** 写入持久化 registrar 配置；校验失败抛错（由路由层转 400）。 */
export function savePersistedRegistrarConfig(jarvisHome: unknown, registrarUrl: string, registrarToken: string): MatrixRegistrarConfig {
  const validated = validateRegistrarPair(registrarUrl, registrarToken);
  if (!validated) {
    throw new Error("registrarUrl 必须是 http(s) URL 且 registrarToken 非空");
  }
  if (typeof jarvisHome !== "string" || !jarvisHome) {
    throw new Error("无法定位 JARVIS_HOME，不能保存 registrar 配置");
  }
  mkdirSync(jarvisHome, { recursive: true });
  const payload = JSON.stringify({
    registrarUrl: validated.registrarUrl,
    registrarToken: validated.registrarToken,
    updatedAt: new Date().toISOString(),
  }, null, 2);
  writeFileSync(path.join(jarvisHome, REGISTRAR_CONFIG_FILENAME), payload, "utf8");
  return validated;
}

/** env 优先，回退持久化文件；两者皆无返回 null（未配置）。 */
export function loadMatrixRegistrarConfigWithFile(
  env: Record<string, string | undefined> = process.env,
  jarvisHome: unknown = undefined,
): MatrixRegistrarConfig | null {
  return loadMatrixRegistrarConfig(env) ?? loadPersistedRegistrarConfig(jarvisHome);
}

const MXID_RE = /^@[^\s:]+:[^\s@]+$/;
const HOMESERVER_URL_RE = /^https?:\/\//i;

/**
 * Jarvis 桌面端出厂内置的 AppService 注册凭证（长期有效，非一次性）。
 *
 * as-registrar 配置了 REGISTRATION_TOKEN 时强制校验（server/as-registrar/handler.ts），
 * 校验为常量时间字符串比较，没有"消耗/失效"逻辑：所有 Jarvis 节点共用同一令牌，
 * 各自注册互不影响。桌面用户无需填写；REGISTRATION_TOKEN env 或 bind 请求体里的
 * registrationToken 可覆盖默认值（运维/测试用）。
 */
export const DEFAULT_MATRIX_REGISTRATION_TOKEN = "0856057bee9b5f091fff593916ff8355c6bda9858d0dc9837ffc02efd28b96f8";

/**
 * 出厂内置的 as-registrar 连接配置（bitjarvis.chat 官方服务），与 REGISTRATION_TOKEN
 * 同为公开的部署常量：桌面用户零配置即可绑定；自建服务器时用 REGISTRAR_URL /
 * REGISTRAR_TOKEN env 或"IM 绑定"设置面板覆盖。
 *
 * 注意 REGISTRAR_URL 是基址（不含 /_jarvis 前缀）：registerAppService 会自行拼接
 * `/_jarvis/appservice/register`，Caddy 对 `/_jarvis/*` 原样转发到 registrar。
 */
export const DEFAULT_MATRIX_REGISTRAR_URL = "https://bitjarvis.chat";
export const DEFAULT_MATRIX_REGISTRAR_TOKEN = "0d5212fb8f3f6130f4aa87d8cf0ab4c31a761e603c84dacde9872709c5f04b8e";

/** 遍历 engine.agents（Map 或对象）并 await 回调 (agentId, agent)。 */
async function forEachAgent(engine: any, fn: (agentId: string, agent: any) => Promise<void> | void) {
  const agents = engine?.agents;
  if (!agents) return;
  const entries = typeof agents.forEach === "function"
    ? [...(agents as Map<string, any>).entries()]
    : Object.entries(agents);
  for (const [agentId, agent] of entries) {
    if (agent && agentId) await fn(String(agentId), agent as any);
  }
}

function normalizeBridgeManagerRef(ref: any) {
  if (ref && typeof ref.get === "function") {
    return {
      get: ref.get,
      ensureReady: ref.ensureReady || ref.get,
      getState: ref.getState || (() => ({ ready: !!ref.get(), initializing: false, error: null })),
    };
  }
  if (typeof ref === "function") {
    return {
      get: ref,
      ensureReady: ref,
      getState: () => ({ ready: !!ref(), initializing: false, error: null }),
    };
  }
  return {
    get: () => ref || null,
    ensureReady: async () => ref || null,
    getState: () => ({ ready: !!ref, initializing: false, error: null }),
  };
}

/** 读取任一 agent 已有 matrix.spaceRoomId（优先 none 返回 null）。 */
function existingSpaceRoomId(engine: any): string | null {
  let found: string | null = null;
  const agents = engine?.agents;
  if (!agents) return found;
  const entries = typeof agents.forEach === "function"
    ? [...(agents as Map<string, any>).entries()]
    : Object.entries(agents);
  for (const [, agent] of entries) {
    const roomId = agent?.config?.bridge?.matrix?.spaceRoomId;
    if (typeof roomId === "string" && roomId) { found = roomId; break; }
  }
  return found;
}

/**
 * 创建/复用本节点的 Matrix Space（方案 §5.5）。
 *
 * 一个节点一个 Space（nodeSuffix 维度），把所有 Agent 虚拟用户 + owner 拉进去，
 * FluffyChat 原生渲染为可折叠分组。幂等：
 *   - 已存在 spaceRoomId（之前 bind 写回 config）→ 直接复用，不重复创建；
 *   - 无 → 以 AppService 主身份（sender）createRoom(type=m.space) 并 invite 成员；
 *     owner 与虚拟用户的邀请由对应 adapter / 用户侧 handshake 处理。
 *
 * Space 创建失败不阻断绑定（返回 { error } 供调用方提示），因为
 * operator 仍可通过 DM 直接对话，Space 只是分组组织能力。
 */
export async function ensureMatrixSpace({
  api,
  engine,
  senderLocalpart,
  serverName,
  ownerUserId,
  virtualUserIds,
  nodeLabel = "Jarvis",
}: {
  api: ReturnType<typeof createMatrixApi>;
  engine: any;
  senderLocalpart: string;
  serverName: string;
  ownerUserId: string;
  virtualUserIds: string[];
  nodeLabel?: string;
}): Promise<{ roomId: string; created: boolean } | { error: string }> {
  const reused = existingSpaceRoomId(engine);
  if (reused) {
    // 复用已有 Space 时也要补邀：新建 agent 的虚拟用户、换绑后的 owner 可能还不在
    // 房间里（首次 createRoom 的 invite 不含后来者）。已在房间的成员返回
    // M_ALREADY_IN_ROOM / M_FORBIDDEN 等，逐个尝试并忽略失败即可。
    const senderUserId = `@${senderLocalpart}:${serverName}`;
    const missing = [ownerUserId, ...virtualUserIds].filter((id) => id && id !== senderUserId);
    for (const member of missing) {
      try {
        await api.inviteToRoom({ userId: senderUserId, roomId: reused, member });
      } catch {
        // 已在房间 / 无权限等——补邀尽力而为，不阻断绑定
      }
    }
    return { roomId: reused, created: false };
  }

  const senderUserId = `@${senderLocalpart}:${serverName}`;
  const invite = [ownerUserId, ...virtualUserIds].filter((id) => id && id !== senderUserId);
  let payload: { room_id: string };
  try {
    payload = await api.createRoom({
      userId: senderUserId,
      name: `${nodeLabel} · Jarvis 设备`,
      topic: "Jarvis Agent 设备分组（AppService 自动创建）",
      type: "m.space",
      preset: "private_chat",
      invite,
      // owner 升 Space admin（共创管），否则 owner 只是被 invite 的普通成员、
      // 无法改名/踢人/加子房间——这正是"管理员应是 IM 用户账号"的修复。
      // 创建者 sender 必须显式带上 100：homeserver 对 power_level_content_override
      // 按顶层键浅合并——users 表整体替换默认 users 表（默认表里创建者才是 100），
      // 只写 owner 会把创建者打到 users_default=0，preset 写初始 m.room.join_rules
      // （需 state_default 50）时鉴权失败 → M_FORBIDDEN，createRoom 整体失败（tuwunel 实测）。
      // 且 sender 后续还要以自身身份写 m.space.child（ensureDmRooms），本来就需要 ≥50。
      powerLevelContentOverride: { users: { [senderUserId]: 100, [ownerUserId]: 100 } },
    });
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }

  if (!payload?.room_id) return { error: "createRoom 未返回 room_id" };
  const roomId = payload.room_id;

  // 写回每个 agent 的 matrix config（同一节点共用同一个 Space）
  const agents = engine?.agents;
  if (agents) {
    const entries = typeof agents.forEach === "function"
      ? [...(agents as Map<string, any>).entries()]
      : Object.entries(agents);
    for (const [, agent] of entries) {
      if (!agent?.config?.bridge?.matrix) continue;
      try {
        agent.updateConfig({ bridge: { matrix: { spaceRoomId: roomId } } });
      } catch {
        // 持久化失败不阻断；下次 bind 会再尝试创建（或复用 homeserver 侧已经建好的房间）
      }
    }
  }
  return { roomId, created: true };
}

/**
 * 为每个已绑定 matrix 的虚拟用户建/复用 DM 子房间（owner + 虚拟用户，is_direct），
 * 并发 m.space.child state event 把 DM 关联到 Space。FluffyChat Space 主视图靠
 * m.space.child 渲染子房间；没有它 Space 主视图空，只能去设置看成员。
 *
 * 幂等：dmRoomId 记在 agent config.bridge.matrix.dmRoomId，复用不再重建；
 * m.space.child 重复发同 state_key 无害。
 */
export async function ensureDmRooms({
  api,
  engine,
  nodeSuffix,
  serverName,
  ownerUserId,
  spaceRoomId,
  senderLocalpart,
}: {
  api: ReturnType<typeof createMatrixApi>;
  engine: any;
  nodeSuffix: string;
  serverName: string;
  ownerUserId: string;
  spaceRoomId: string;
  senderLocalpart: string;
}): Promise<{ created: string[]; errors: string[] }> {
  const created: string[] = [];
  const errors: string[] = [];
  const via = [serverName];
  const senderUserId = `@${senderLocalpart}:${serverName}`;
  await forEachAgent(engine, async (agentId, agent) => {
    const cfg = agent?.config?.bridge?.matrix;
    if (!cfg?.enabled) return;
    const localpart = sanitizeAgentLocalpart(agentId);
    if (!localpart) return;
    const virtualUserId = `@${localpart}_${nodeSuffix}:${serverName}`;
    let dmRoomId = typeof cfg.dmRoomId === "string" && cfg.dmRoomId ? cfg.dmRoomId : null;
    if (!dmRoomId) {
      try {
        const r = await api.createRoom({
          userId: virtualUserId,
          preset: "private_chat",
          isDirect: true,
          invite: [ownerUserId],
        });
        dmRoomId = r?.room_id || null;
      } catch (err: any) {
        errors.push(`${agentId} DM 创建失败: ${err?.message || err}`);
      }
      if (dmRoomId) {
        try {
          agent.updateConfig({ bridge: { matrix: { dmRoomId } } });
        } catch {
          // 持久化失败不阻断；下次 bind 会重建（dmRoomId 没记下）
        }
      }
    }
    if (dmRoomId) {
      try {
        await api.sendStateEvent({
          userId: senderUserId,
          roomId: spaceRoomId,
          eventType: "m.space.child",
          stateKey: dmRoomId,
          content: { via, suggested: false },
        });
        created.push(agentId);
      } catch (err: any) {
        errors.push(`${agentId} space.child 关联失败: ${err?.message || err}`);
      }
    }
  });
  return { created, errors };
}

export function createMatrixBindRoute({
  engine,
  bridgeManagerRef,
  env = process.env,
  fetchImpl,
}: {
  engine: any;
  bridgeManagerRef: any;
  env?: Record<string, string | undefined>;
  fetchImpl?: unknown;
}) {
  const route = new Hono();
  const bridgeRef = normalizeBridgeManagerRef(bridgeManagerRef);
  const outboundFetch = fetchImpl as any;
  const jarvisHome = engine?.jarvisHome;

  /** env 优先、回退 {JARVIS_HOME}/matrix-registrar.json，最后兜底出厂内置官方服务；永不为 null。 */
  function resolveRegistrar(): MatrixRegistrarConfig {
    return loadMatrixRegistrarConfigWithFile(env, jarvisHome) ?? {
      registrarUrl: DEFAULT_MATRIX_REGISTRAR_URL,
      registrarToken: DEFAULT_MATRIX_REGISTRAR_TOKEN,
    };
  }

  function resolveBridgeManager() {
    return bridgeRef.get?.() || null;
  }

  function registrarUnavailable(c: any, message: string, detail: any = null) {
    return c.json({
      ok: false,
      error: message,
      ...(detail ? { detail } : {}),
    }, 503);
  }

  /**
   * 调 as-registrar 注册本节点 AppService（P1 产物）。
   * 相同 nodeSuffix 幂等替换（registrationId 固定），as_token 每次重新签发。
   */
  async function registerAppService(registrar: MatrixRegistrarConfig, nodeSuffix: string, registrationToken?: string) {
    const http = createBridgeOutboundHttp({ platform: "matrix", ...(outboundFetch ? { fetchImpl: outboundFetch } : {}) });
    const res: any = await http.request({
      stage: "appservice_register",
      url: `${registrar.registrarUrl}/_jarvis/appservice/register`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${registrar.registrarToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nodeId: nodeSuffix,
        ...(registrationToken ? { registrationToken } : {}),
      }),
      timeoutMs: 20_000,
      idempotent: true,
      maxRetries: 1,
    });
    const text = await res.text().catch(() => "");
    let payload: any = {};
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (res.status < 200 || res.status >= 300 || !payload?.asToken || !payload?.nodeSuffix) {
      const detail = payload?.detail || payload?.error || `HTTP ${res.status}`;
      const errcode = payload?.errcode || `HTTP_${res.status}`;
      throw new Error(`${errcode} ${detail}`);
    }
    return payload as {
      registrationId: string;
      nodeSuffix: string;
      asToken: string;
      hsToken: string;
      senderLocalpart: string;
      homeserverUrl: string;
    };
  }

  /** 绑定（方案 §4.1）：注册 AppService → 虚拟用户 + owner + 启动 adapter。 */
  route.post("/bridge/matrix/bind", async (c) => {
    const scopeDenied = denyWithoutScope(c, "bridge.manage");
    if (scopeDenied) return scopeDenied;

    const body = await safeJson(c);
    const bodyObj: any = body || {};
    const { imUserId, homeserverUrl } = bodyObj;
    // registrationToken：请求体 > REGISTRATION_TOKEN env > 出厂默认值（长期有效，所有节点共用）。
    const registrationToken =
      (typeof bodyObj.registrationToken === "string" && bodyObj.registrationToken.trim()) ||
      (env["REGISTRATION_TOKEN"] || "").trim() ||
      DEFAULT_MATRIX_REGISTRATION_TOKEN;

    if (typeof imUserId !== "string" || !MXID_RE.test(imUserId.trim())) {
      return c.json({ ok: false, error: "imUserId 必须是 Matrix 用户 ID（@user:server）" }, 400);
    }
    const orgHomeserverUrl = typeof homeserverUrl === "string" ? homeserverUrl.trim().replace(/\/+$/, "") : "";
    if (!orgHomeserverUrl || !HOMESERVER_URL_RE.test(orgHomeserverUrl)) {
      return c.json({ ok: false, error: "homeserverUrl 必须是 http(s) URL" }, 400);
    }

    // registrar 永不为 null（env / 配置文件 / 出厂内置三级回退），无需未配置分支。
    const registrar = resolveRegistrar();

    const runtimeContext = typeof engine.getRuntimeContext === "function" ? engine.getRuntimeContext() : {};
    const serverNodeId = runtimeContext?.serverNodeId || runtimeContext?.serverId;
    if (!serverNodeId) {
      return registrarUnavailable(c, "无法确定本节点标识（serverNodeId）");
    }

    let nodeSuffix: string;
    try {
      nodeSuffix = nodeSuffixForServerNodeId(serverNodeId);
    } catch (err: any) {
      return registrarUnavailable(c, "无法派生 matrix 节点后缀", err?.message || String(err));
    }

    let registration: Awaited<ReturnType<typeof registerAppService>>;
    try {
      registration = await registerAppService(registrar, nodeSuffix, registrationToken);
    } catch (err: any) {
      debugLog()?.error("api", `[matrix] appservice register failed: ${err?.message || err}`);
      return registrarUnavailable(c, "as-registrar 注册失败", err?.message || String(err));
    }

    // registrar 返回的 homeserverUrl 是"服务器视角"的地址（registrar 在服务器上
    // 本地访问 tuwunel 的 127.0.0.1:8008），桌面端不可达——直接用它会在客户端侧
    // 虚拟用户注册/Space 创建时 ECONNREFUSED。这里一律用用户登录 FluffyChat 的
    // 同一 homeserver 公网入口（orgHomeserverUrl）：注册目标就是该 homeserver，
    // as_token 通用；仅当请求体缺失时回退 registrar 返回值。
    const hsUrl = orgHomeserverUrl || registration.homeserverUrl;
    let serverName = "";
    try {
      serverName = serverNameFromUrl(hsUrl);
    } catch (err: any) {
      return registrarUnavailable(c, "homeserverUrl 解析失败", err?.message || String(err));
    }

    const api = createMatrixApi({
      homeserverUrl: hsUrl,
      accessToken: registration.asToken,
      ...(outboundFetch ? { fetchImpl: outboundFetch } : {}),
    });

    const matchedAgents: any[] = [];
    const registrationErrors: any[] = [];

    await forEachAgent(engine, async (agentId, agent) => {
      const localpart = sanitizeAgentLocalpart(agentId);
      if (!localpart) {
        registrationErrors.push({ agentId, error: `agentId 无法映射为合法 Matrix localpart: "${agentId}"` });
        return;
      }
      const senderUserId = `@${localpart}_${nodeSuffix}:${serverName}`;
      const cfg = {
        enabled: true,
        homeserverUrl: hsUrl,
        asToken: registration.asToken,
        senderUserId,
        nodeSuffix,
        registrationId: registration.registrationId,
        serverName,
        owner: imUserId.trim(),
      };

      // 虚拟用户注册：已存在（M_USER_IN_USE）视为成功
      let virtualUserRegistered = true;
      let registerError: string | null = null;
      try {
        await api.registerApplicationServiceUser({ username: `${localpart}_${nodeSuffix}` });
      } catch (err: any) {
        const errcode = err instanceof MatrixApiError ? err.errcode : null;
        if (errcode === "M_USER_IN_USE") {
          virtualUserRegistered = true;
        } else {
          virtualUserRegistered = false;
          registerError = err?.message || String(err);
        }
      }

      // P1: 设置虚拟用户展示名（agent persona 名 config.agent.name，可为中文）+ 在线状态——FluffyChat 不再显示丑 MXID，
      // 且能一眼看到在线。失败不阻断（homeserver 可能不支持 appservice 代设 profile/presence）。
      const agentName = resolveAgentDisplayName(agent, agentId);
      try {
        await api.setDisplayName({ userId: senderUserId, displayname: agentName });
      } catch (err: any) {
        debugLog()?.warn("api", `[matrix] setDisplayName(${senderUserId}) 失败: ${err?.message || err}`);
      }
      try {
        await api.setPresence({ userId: senderUserId, presence: "online" });
      } catch {
        // ignore
      }

      // C2：同步 agent 头像到虚拟用户（uploadMedia → setAvatarUrl）。
      // 失败不阻断绑定（homeserver 可能不支持 appservice 代设 avatar）。
      try {
        const avatar = resolveAgentAvatarFile(engine, agentId);
        if (avatar) {
          const { content_uri } = await api.uploadMedia({
            userId: senderUserId,
            filename: avatar.filename,
            mimeType: avatar.mimeType,
            buffer: avatar.buffer,
          });
          await api.setAvatarUrl({ userId: senderUserId, avatarUrl: content_uri });
        }
      } catch (err: any) {
        debugLog()?.warn("api", `[matrix] avatar sync for ${agentId} 失败: ${err?.message || err}`);
      }

      try {
        agent.updateConfig({ bridge: { matrix: cfg } });
      } catch (err: any) {
        registrationErrors.push({ agentId, error: `保存 config 失败: ${err?.message || err}` });
        return;
      }

      const manager = resolveBridgeManager();
      if (manager && typeof manager.startPlatformFromConfig === "function") {
        try {
          manager.startPlatformFromConfig("matrix", { ...cfg }, agentId);
        } catch (err: any) {
          debugLog()?.warn("api", `[matrix] start adapter for ${agentId} failed: ${err?.message || err}`);
        }
      }

      matchedAgents.push({
        agentId,
        senderUserId,
        virtualUserRegistered,
        ...(registerError ? { registrationError: registerError } : {}),
      });
    });

    // §5.5 创建/复用 Space（幂等；失败不阻断绑定）
    const space = await ensureMatrixSpace({
      api,
      engine,
      senderLocalpart: registration.senderLocalpart,
      serverName,
      ownerUserId: imUserId.trim(),
      virtualUserIds: matchedAgents.map((agent: any) => agent.senderUserId),
      nodeLabel: runtimeContext?.label || "Jarvis",
    });

    // §5.5b 为每个虚拟用户建/复用 DM 子房间并关联到 Space（m.space.child）。
    // FluffyChat Space 主视图靠 m.space.child 渲染子房间，没有则空（只能去设置看成员）。
    let dmSummary: { created: string[]; errors: string[] } | null = null;
    if (space && "roomId" in space) {
      dmSummary = await ensureDmRooms({
        api,
        engine,
        nodeSuffix,
        serverName,
        ownerUserId: imUserId.trim(),
        spaceRoomId: space.roomId,
        senderLocalpart: registration.senderLocalpart,
      });
    }

    debugLog()?.log("api", `POST /api/bridge/matrix/bind nodeSuffix=${nodeSuffix} agents=${matchedAgents.length}`);
    return c.json({
      ok: true,
      registrationId: registration.registrationId,
      nodeSuffix,
      serverName,
      homeserverUrl: hsUrl,
      imUserId: imUserId.trim(),
      matchedAgents,
      space: space && "roomId" in space
        ? { roomId: space.roomId, created: space.created }
        : { error: (space as any)?.error || "space creation skipped" },
      ...(dmSummary?.errors.length ? { dmErrors: dmSummary.errors } : {}),
      ...(registrationErrors.length ? { registrationErrors } : {}),
    });
  });

  /** 绑定状态（ImView / 设置页轮询用）。 */
  route.get("/bridge/matrix/status", async (c) => {
    const registrar = resolveRegistrar();
    const manager = resolveBridgeManager();
    const result: any = {
      ok: true,
      // registrar 三级回退（env / 文件 / 出厂内置），恒可用。
      registrarConfigured: true,
      registrarUrl: registrar.registrarUrl,
      bound: false,
      homeserverUrl: null,
      serverName: null,
      nodeSuffix: null,
      agents: {},
      totalAgents: 0,
      unboundAgents: [],
    };
    await forEachAgent(engine, (agentId, agent) => {
      result.totalAgents++;
      const cfg = agent?.config?.bridge?.matrix;
      if (!cfg) {
        // 尚未绑定 matrix 的 agent（如新建的）——供 UI 自动补绑
        result.unboundAgents.push(agentId);
        return;
      }
      const live = manager?.getStatus?.(agentId)?.matrix || null;
      let derivedServerName = null;
      try {
        derivedServerName = cfg.serverName || serverNameFromUrl(cfg.homeserverUrl);
      } catch {
        derivedServerName = null;
      }
      result.agents[agentId] = {
        enabled: !!cfg.enabled,
        owner: cfg.owner || null,
        senderUserId: cfg.senderUserId || null,
        nodeSuffix: cfg.nodeSuffix || null,
        serverName: derivedServerName,
        spaceRoomId: cfg.spaceRoomId || null,
        status: live?.status || (cfg.enabled ? "disconnected" : "unbound"),
        error: live?.error || null,
      };
      if (cfg.enabled) {
        result.bound = true;
        result.homeserverUrl = cfg.homeserverUrl || result.homeserverUrl;
        result.serverName = derivedServerName || result.serverName;
        result.nodeSuffix = cfg.nodeSuffix || result.nodeSuffix;
        if (cfg.spaceRoomId) result.spaceRoomId = cfg.spaceRoomId;
      }
    });
    return c.json(result);
  });

  /** 解绑：停 adapter、禁平台、清 owner（保留 as_token 便于重新启用）。 */
  route.post("/bridge/matrix/unbind", async (c) => {
    const scopeDenied = denyWithoutScope(c, "bridge.manage");
    if (scopeDenied) return scopeDenied;

    const manager = resolveBridgeManager();
    const unboundAgents: string[] = [];
    await forEachAgent(engine, (agentId, agent) => {
      const cfg = agent?.config?.bridge?.matrix;
      if (!cfg) return;
      manager?.stopPlatform?.("matrix", agentId);
      agent.updateConfig({ bridge: { matrix: { enabled: false, owner: null } } });
      unboundAgents.push(agentId);
    });
    debugLog()?.log("api", `POST /api/bridge/matrix/unbind agents=${unboundAgents.length}`);
    return c.json({ ok: true, unboundAgents });
  });

  /**
   * 读取 as-registrar 连接配置（供桌面端“IM 绑定”设置面板预填）。
   * 不回显 token，只返回是否已设置；registrarUrl 可回显（非机密）。
   */
  route.get("/bridge/matrix/registrar-config", (c) => {
    const fromEnv = loadMatrixRegistrarConfig(env);
    const fromFile = loadPersistedRegistrarConfig(jarvisHome);
    const registrar = fromEnv ?? fromFile;
    return c.json({
      ok: true,
      configured: true,
      registrarUrl: registrar?.registrarUrl || DEFAULT_MATRIX_REGISTRAR_URL,
      hasToken: true,
      source: fromEnv ? "env" : (fromFile ? "file" : "default"),
    });
  });

  /**
   * 保存 as-registrar 连接配置到 {JARVIS_HOME}/matrix-registrar.json。
   * 写入后下一次 bind/status 即可读到（live 生效，无需重启 server）。
   * env 已配置时文件仍可写，但 env 优先级更高（写入仅作为兜底）。
   */
  route.post("/bridge/matrix/registrar-config", async (c) => {
    const scopeDenied = denyWithoutScope(c, "bridge.manage");
    if (scopeDenied) return scopeDenied;

    const body = await safeJson(c);
    const registrarUrl = typeof body?.registrarUrl === "string" ? body.registrarUrl : "";
    let registrarToken = typeof body?.registrarToken === "string" ? body.registrarToken.trim() : "";
    // 允许只改 URL：token 留空时复用已持久化的 token（客户端用占位符表示"已保存"）
    if (!registrarToken) {
      const existing = loadPersistedRegistrarConfig(jarvisHome);
      if (existing?.registrarToken) registrarToken = existing.registrarToken;
    }
    try {
      const saved = savePersistedRegistrarConfig(jarvisHome, registrarUrl, registrarToken);
      debugLog()?.log("api", `POST /api/bridge/matrix/registrar-config url=${saved.registrarUrl}`);
      return c.json({ ok: true, configured: true, registrarUrl: saved.registrarUrl, hasToken: true, source: "file" });
    } catch (err: any) {
      return c.json({ ok: false, error: err?.message || String(err) }, 400);
    }
  });

  /**
   * C3：Agent 昵称 / 头像变更后重同步到 Matrix 虚拟用户（与 bind 时的初始同步同一套逻辑）。
   * body: { agentId }
   */
  route.post("/bridge/matrix/refresh-profile", async (c) => {
    const scopeDenied = denyWithoutScope(c, "bridge.manage");
    if (scopeDenied) return scopeDenied;

    const body = await safeJson(c);
    const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
    const result = await syncMatrixProfileForAgent(engine, agentId, outboundFetch);
    if (result.reason === "not-bound") {
      return c.json({ ok: false, error: `agent "${agentId || "(missing)"}" 未绑定 Matrix 或缺少凭据字段` }, 400);
    }
    debugLog()?.log("api", `POST /api/bridge/matrix/refresh-profile agent=${agentId}`);
    return c.json({ ok: result.ok, results: result.results });
  });

  return route;
}