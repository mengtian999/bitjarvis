/**
 * matrix-identity.ts — Matrix 虚拟用户 ID 解析/构造
 *
 * 虚拟用户命名规范（IM模块内嵌桌面端方案.md §5.1）：
 *
 *   @{agentId}_{nodeSuffix}:{serverName}
 *
 *   例：@jarvis_home3f2a:bitjarvis.chat
 *       → agentId = "jarvis"，nodeSuffix = "home3f2a"
 *
 * nodeSuffix 固定 8 位小写字母/数字（serverNodeId 前 8 位，如 home3f2a / offc7b1c，
 * 避免跨节点重名）。解析采用「最后一个下划线段且命中规则」，agentId 本身允许
 * 包含下划线。只要不匹配该规范（例如普通用户 @alice:bitjarvis.chat）就返回 null，
 * 调用方据此区分「本节点虚拟用户」与「真人/其他用户」。
 */

import { randomBytes } from "node:crypto";

/** nodeSuffix 长度（serverNodeId 前 8 位）。 */
export const NODE_SUFFIX_LENGTH = 8;

/** nodeSuffix 规则：8 位小写字母/数字（Matrix localpart 安全字符子集）。 */
const NODE_SUFFIX_RE = new RegExp(`^[a-z0-9]{${NODE_SUFFIX_LENGTH}}$`);
const MXID_RE = /^@([^:]+):(.+)$/;
/** Matrix user localpart 合法字符（规范 user identifier 语法）。 */
const LOCALPART_RE = /^[a-z0-9._=+/-]+$/;

export function isValidNodeSuffix(value: unknown): value is string {
  return typeof value === "string" && NODE_SUFFIX_RE.test(value);
}

/** 生成随机 nodeSuffix（8 位小写字母/数字，用于本地开发/验证脚本）。 */
export function randomNodeSuffix(): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const bytes = randomBytes(NODE_SUFFIX_LENGTH);
  let out = "";
  for (let i = 0; i < NODE_SUFFIX_LENGTH; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export interface VirtualUserId {
  /** 完整 MXID，如 @jarvis_home3f2a:bitjarvis.chat */
  full: string;
  localpart: string;
  agentId: string;
  nodeSuffix: string;
  serverName: string;
}

/**
 * 解析虚拟用户 MXID。非虚拟用户（无 nodeSuffix 后缀）返回 null。
 */
export function parseVirtualUserId(mxid: unknown): VirtualUserId | null {
  if (typeof mxid !== "string") return null;
  const match = MXID_RE.exec(mxid);
  if (!match) return null;
  const [, localpart, serverName] = match;
  const idx = localpart.lastIndexOf("_");
  if (idx === -1) return null;
  const nodeSuffix = localpart.slice(idx + 1);
  const agentId = localpart.slice(0, idx);
  if (!agentId || !isValidNodeSuffix(nodeSuffix)) return null;
  return { full: mxid, localpart, agentId, nodeSuffix, serverName };
}

/**
 * 构造虚拟用户 MXID。参数不合法时抛错（宁可 fail-fast 也不生成错误身份）。
 */
export function buildVirtualUserId({ agentId, nodeSuffix, serverName }: {
  agentId: string;
  nodeSuffix: string;
  serverName: string;
}): string {
  if (!agentId || typeof agentId !== "string") throw new Error("buildVirtualUserId requires agentId");
  if (!isValidNodeSuffix(nodeSuffix)) throw new Error(`buildVirtualUserId requires an ${NODE_SUFFIX_LENGTH}-char [a-z0-9] nodeSuffix`);
  if (!serverName || typeof serverName !== "string") throw new Error("buildVirtualUserId requires serverName");
  const localpart = `${agentId}_${nodeSuffix}`;
  if (!LOCALPART_RE.test(localpart)) {
    throw new Error(`buildVirtualUserId: illegal localpart "${localpart}"`);
  }
  return `@${localpart}:${serverName}`;
}

/** 提取任意 MXID 的 localpart（无 @/: 结构时原样返回）。 */
export function localpartOf(mxid: unknown): string {
  if (typeof mxid !== "string") return "";
  const match = MXID_RE.exec(mxid);
  return match ? match[1] : mxid;
}
