/**
 * registration.ts — AppService registration 生成（Tuwunel 格式）
 *
 * 生成 YAML 后由 admin-room.ts 以 admin 账号向 Tuwunel admin room 发送：
 *   !admin appservices register
 *   ```yaml
 *   <registration YAML>
 *   ```
 * Tuwunel 用 serde_yaml 解析并持久化到数据库（相同 id 幂等替换，立即生效）。
 *
 * 自包含模块：as-registrar 是独立部署的服务（bitjarvis.chat 侧），
 * 不 import 项目 lib/，避免部署耦合。
 */

import { randomBytes } from "node:crypto";

/** nodeSuffix 长度（serverNodeId 前 8 位）。 */
export const NODE_SUFFIX_LENGTH = 8;
const NODE_SUFFIX_RE = new RegExp(`^[a-z0-9]{${NODE_SUFFIX_LENGTH}}$`);
/** Matrix user localpart 合法字符。 */
const LOCALPART_RE = /^[a-z0-9._=+/-]+$/;

export interface AppServiceRegistration {
  id: string;
  url: null;
  as_token: string;
  hs_token: string;
  sender_localpart: string;
  namespaces: {
    users: Array<{ exclusive: boolean; regex: string }>;
    rooms: unknown[];
    aliases: unknown[];
  };
}

/** 生成 URL 安全的随机令牌（base64url，32 字节熵）。 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 规整 nodeId → nodeSuffix：接受任意长度的 node id，取前 8 位并要求是 hex。
 * 非 hex 时抛错（fail-fast，避免生成错误命名空间正则）。
 */
export function normalizeNodeSuffix(nodeId: unknown): string {
  const raw = typeof nodeId === "string" ? nodeId.trim().toLowerCase() : "";
  if (!raw) throw new Error("nodeId is required");
  const suffix = raw.slice(0, NODE_SUFFIX_LENGTH);
  if (!NODE_SUFFIX_RE.test(suffix)) {
    throw new Error(`nodeId must start with ${NODE_SUFFIX_LENGTH} alphanumeric chars (a-z0-9), got: "${nodeId}"`);
  }
  return suffix;
}

/**
 * 生成 registration 对象。
 * url: null = receive-only（不推送事件，由 AppService 主动 /sync 拉取，Poll 模式）。
 */
export function buildRegistration({ nodeId, senderLocalpart }: {
  nodeId: string;
  senderLocalpart?: string | null;
}): { registration: AppServiceRegistration; nodeSuffix: string; asToken: string; hsToken: string } {
  const nodeSuffix = normalizeNodeSuffix(nodeId);
  const localpart = (senderLocalpart || `jarvis_${nodeSuffix}`).trim().toLowerCase();
  if (!LOCALPART_RE.test(localpart)) {
    throw new Error(`illegal sender_localpart "${localpart}" (allowed: a-z 0-9 . _ = + - /)`);
  }
  const asToken = generateToken();
  const hsToken = generateToken();
  const registration: AppServiceRegistration = {
    id: `jarvis_node_${nodeSuffix}`,
    url: null,
    as_token: asToken,
    hs_token: hsToken,
    sender_localpart: localpart,
    namespaces: {
      users: [{ exclusive: true, regex: `@.*_${nodeSuffix}` }],
      rooms: [],
      aliases: [],
    },
  };
  return { registration, nodeSuffix, asToken, hsToken };
}

/**
 * 手写 YAML 序列化（避免给独立服务引入 js-yaml 依赖）。
 * 只覆盖 registration 的固定结构，字符串按需加双引号（regex 必须引号包裹）。
 */
export function registrationToYaml(registration: AppServiceRegistration): string {
  const lines: string[] = [];
  lines.push(`id: ${yamlString(registration.id)}`);
  lines.push(`url: null`);
  lines.push(`as_token: ${yamlString(registration.as_token)}`);
  lines.push(`hs_token: ${yamlString(registration.hs_token)}`);
  lines.push(`sender_localpart: ${yamlString(registration.sender_localpart)}`);
  lines.push(`namespaces:`);
  lines.push(`  users:`);
  for (const user of registration.namespaces.users) {
    lines.push(`    - exclusive: ${user.exclusive ? "true" : "false"}`);
    lines.push(`      regex: ${yamlString(user.regex)}`);
  }
  lines.push(`  rooms: []`);
  lines.push(`  aliases: []`);
  return lines.join("\n");
}

function yamlString(value: string): string {
  // 统一双引号包裹（serde_yaml 兼容性最稳；null/bool/数组单独处理）
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** 组装 Tuwunel admin room 注册命令（```yaml 围栏代码块包裹，见 Tuwunel register.rs）。 */
export function buildAdminRegisterCommand(registration: AppServiceRegistration): string {
  return `!admin appservices register\n\`\`\`yaml\n${registrationToYaml(registration)}\n\`\`\``;
}

/** 组装 unregister 命令（idempotent 清理用）。
 *
 * 注意：id 不加引号——tuwunel 的 admin 命令参数解析不剥引号，带引号的 id 会匹配
 * 不到（实测回 "Appservice not found"）。registrationId 是 [a-z0-9_] 安全字符，
 * 直接输出即可。 */
export function buildAdminUnregisterCommand(registrationId: string): string {
  return `!admin appservices unregister ${registrationId}`;
}
