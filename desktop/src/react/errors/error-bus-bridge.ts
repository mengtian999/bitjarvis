/**
 * error-bus-bridge.ts — ErrorBus (shared) → Zustand toast store bridge
 *
 * Call initErrorBusBridge() once during app init to wire up the renderer-side
 * ErrorBus subscriber to the toast slice.
 *
 * 分流纪律（Error Suppression）：
 *   1. route=toast 才弹 toast。bus 侧已把 WS_DISCONNECTED（statusbar）、
 *      critical（boundary）和 cosmetic 噪音（silent）分流出去；
 *   2. 会话内已经用 inline 提示呈现过的可恢复错误，这里不再弹第二遍全局 toast
 *      ——同一条失败同时出现「全局弹窗 + 会话内错误条」是最刺眼的双重提示；
 *   3. 同 code 的 toast 去重交给 toast store（dedupeKey=code），配合 bus 侧 60s
 *      抑制窗口，一次故障周期内最多看到一条。
 */

import { errorBus } from '../../../../shared/error-bus.ts';
import { useStore } from '../stores';
import { translateKeyOrNull } from './error-presenter';
import type { ErrorRoute } from './types';

/**
 * 由会话内 inline 提示 / 重试条接管的可恢复错误码：不弹全局 toast。
 *
 * - LLM_TIMEOUT / LLM_RATE_LIMITED / LLM_EMPTY_RESPONSE：模型流失败时服务端会下发
 *   code=turn_interrupted，ws-message-handler 写入带「重试 / 继续任务」按钮的中断条；
 *   后台 utility 调用（标题 / 摘要等）失败则内部重试后静默降级。两种情况都不需要
 *   再叠一条全局提醒。
 * - turn_interrupted：同上，中断条本身就是唯一入口。
 */
const INLINE_SURFACED_ERROR_CODES = new Set([
  'LLM_TIMEOUT',
  'LLM_RATE_LIMITED',
  'LLM_EMPTY_RESPONSE',
  'turn_interrupted',
]);

export function initErrorBusBridge(): void {
  errorBus.subscribe((entry, route) => {
    const routeKey = route as ErrorRoute;
    const { error } = entry;
    // 本地化文案优先。以前把 error.message 排在最前，而后端几乎总会带一句英文
    // message，于是 userMessageKey 永远轮不到，整套 i18n 形同虚设。
    const userMessage = translateKeyOrNull(error.userMessageKey) || error.message || error.code;

    switch (routeKey) {
      case 'toast':
        // 已在会话内呈现过的可恢复错误：只保留日志 / breadcrumb，不再弹全局 toast。
        if (INLINE_SURFACED_ERROR_CODES.has(error.code)) break;
        useStore.getState().addToast(
          userMessage,
          error.severity === 'cosmetic' ? 'warning' : 'error',
          error.severity === 'critical' ? 0 : 5000,
          {
            errorCode: error.code,
            persistent: error.severity === 'critical',
            dedupeKey: error.code,
          }
        );
        break;
      case 'statusbar':
        // WebSocket manages its own wsState in connection-slice
        break;
      case 'boundary':
        // ErrorBoundary catches render errors directly
        break;
      case 'silent':
        // Log only (already logged by ErrorBus._log)
        break;
    }
  });
}
