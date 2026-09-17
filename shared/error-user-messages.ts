/**
 * error-user-messages.ts — 后端错误码 → 用户文案 i18n key
 *
 * 跟 ERROR_DEFS（shared/errors.ts）分工不同：那张表管错误的分类与路由
 * （severity / category / retryable / httpStatus），条目是 LLM_TIMEOUT 这类
 * 基础设施级错误；这张表只管一件事——把 route handler 抛出的业务错误码翻译成
 * 用户看得懂的一句话。
 *
 * 收录标准：用户在正常使用中真的会撞到、并且会显示在 inline error 或 toast 上的
 * 错误码。内部一致性校验类的码（写坏了才会出现）不收录，交给兜底文案，原始英文
 * 仍会保留在详情区，排障不丢信息。
 */

/** 高频业务错误码 → i18n key。未收录的码走 UNKNOWN_ERROR_MESSAGE_KEY。 */
export const ERROR_CODE_MESSAGE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  // 会话分支 / 重试：活跃任务无法被两个会话共享，这是 Fork 最常见的拒绝理由
  session_fork_active_task: 'error.code.sessionForkActiveTask',
  session_fork_unavailable: 'error.code.sessionForkUnavailable',
  subagent_session_fork_cycle: 'error.code.subagentSessionForkCycle',
  subagent_run_busy: 'error.code.subagentRunBusy',
  subagent_thread_busy: 'error.code.subagentThreadBusy',
  workflow_run_busy: 'error.code.workflowRunBusy',
  workflow_node_busy: 'error.code.workflowNodeBusy',

  // 会话生命周期：新建 / 切换 / 删除
  session_busy: 'error.code.sessionBusy',
  session_not_loaded: 'error.code.sessionNotLoaded',
  session_identity_conflict: 'error.code.sessionIdentityConflict',
  session_identity_unresolved: 'error.code.sessionIdentityUnresolved',
  session_identity_mismatch: 'error.code.sessionIdentityMismatch',
  session_manifest_not_found: 'error.code.sessionManifestNotFound',
  session_locator_not_active: 'error.code.sessionLocatorNotActive',
  active_session_conflict: 'error.code.activeSessionConflict',
  session_delete_staged_conflict: 'error.code.sessionDeleteStagedConflict',

  // 文件与上传
  file_too_large: 'error.code.fileTooLarge',
  invalid_upload: 'error.code.invalidUpload',
  invalid_path: 'error.code.invalidPath',

  // 模型 / 工作区 / 权限
  no_available_model: 'error.code.noAvailableModel',
  workspace_not_found: 'error.code.workspaceNotFound',
  capability_denied: 'error.code.capabilityDenied',
});

/** 未收录错误码与无码异常共用的兜底文案 key。 */
export const UNKNOWN_ERROR_MESSAGE_KEY = 'error.code.unexpected';

/** 错误码的形态：全小写、下划线分隔，用来把 code 跟人写的英文句子区分开。 */
const ERROR_CODE_SHAPE = /^[a-z][a-z0-9_]*$/;

/**
 * 查错误码对应的文案 key。查不到返回 null，由调用方显式决定兜底，
 * 不在这里悄悄返回 UNKNOWN——调用方需要知道自己拿到的是精确文案还是兜底。
 */
export function userMessageKeyForCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const normalized = code.trim();
  if (!normalized) return null;
  return ERROR_CODE_MESSAGE_KEYS[normalized] ?? null;
}

/**
 * 从后端错误响应体里取出错误码。
 *
 * 大部分 route 走 `{ error: "英文句子", code: "some_code" }`，但少数老 route 直接
 * 应答 `{ error: "session_busy" }`，错误码就是 error 字段本身。这里按形态区分：
 * 只有全小写下划线、不含空格的值才当作错误码，"session not found" 这类人写的
 * 句子不会被误认。
 */
export function errorCodeFromResponseBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;

  const explicit = typeof record.code === 'string' ? record.code.trim() : '';
  if (explicit) return explicit;

  const errorField = typeof record.error === 'string' ? record.error.trim() : '';
  if (errorField && ERROR_CODE_SHAPE.test(errorField)) return errorField;

  return null;
}
