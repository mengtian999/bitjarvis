/**
 * user-abort-registry.ts — 用户主动停止请求的短期登记。
 *
 * 服务端 abort 路径（turn_stall_timeout、断线宽限、关机 abort_all 等）与用户
 * 点“停止”按钮产生的 aborted 事件在协议上无法区分，客户端在发送 abort 请求时
 * 在这里登记，收到 `status(aborted:true)` 时据此判断是不是用户自己停的：
 * 登记有效期内命中 → 不弹“任务已中断”提示；未命中 → 视为系统中止并提示。
 */

interface UserAbortEntry {
  streamId: string | null;
  at: number;
}

const USER_ABORT_TTL_MS = 20_000;

/** sessionPath -> 该 session 最近一次用户停止请求的登记列表 */
const registry = new Map<string, UserAbortEntry[]>();

function pruneExpired(now: number): void {
  for (const [path, entries] of registry) {
    const alive = entries.filter((entry) => now - entry.at < USER_ABORT_TTL_MS);
    if (alive.length === 0) registry.delete(path);
    else registry.set(path, alive);
  }
}

/** 用户点了停止按钮（或等价的主动停止入口）时调用。 */
export function markUserAbort(sessionPath: string, streamId?: string | null): void {
  if (!sessionPath) return;
  pruneExpired(Date.now());
  const entries = registry.get(sessionPath) || [];
  entries.push({ streamId: streamId || null, at: Date.now() });
  registry.set(sessionPath, entries);
}

/**
 * 收到 aborted 事件时判断：这个 session 最近是否由用户主动停止。
 * streamId 一侧缺失时按 sessionPath 宽松匹配（用户只能停止当前活跃流）。
 */
export function isUserAbortRecent(sessionPath: string, streamId?: string | null): boolean {
  if (!sessionPath) return false;
  const now = Date.now();
  pruneExpired(now);
  const entries = registry.get(sessionPath);
  if (!entries || entries.length === 0) return false;
  return entries.some((entry) =>
    entry.streamId == null
    || streamId == null
    || entry.streamId === streamId
  );
}

export function resetUserAbortRegistryForTest(): void {
  registry.clear();
}
