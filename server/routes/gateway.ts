/**
 * 网关 REST 路由
 *
 * POST /gateway/sync — 同步网关模型目录（幂等）
 *
 * onboarding 的 Jarvis 路径调用：注册设备 + 拉取档位列表 + 刷新 provider catalog。
 * 不写 agent config / preferences —— 配置写入仍由客户端走既有
 * PUT /agents/:id/config 与 PUT /preferences/models（验证计划记录不变）。
 *
 * 步骤：
 * 1. GatewayClient.ensureDevice() — 设备注册（install_id 幂等，token 失效自动重注册）
 * 2. ensureGatewayProviderRegistered() — 代码级 provider 插件注册（hideApiReveal）
 * 3. syncGatewayModels() — 写 catalog overlay，返回 defaultModelId
 *    （服务端 is_default 标记优先，其次 auto，兜底第一个档位）
 * 4. engine.onProviderChanged() — model-manager 投影刷新
 */
import { Hono } from "hono";
import { createModuleLogger } from "../../lib/debug-log.ts";
import { GATEWAY_PROVIDER_ID } from "../../core/gateway/gateway-sync.ts";

export function createGatewayRoute(engine: any) {
  const route = new Hono();
  const log = createModuleLogger("api-gateway");

  route.post("/gateway/sync", async (c) => {
    try {
      const { GatewayClient } = await import("../../core/gateway/gateway-client.ts");
      const { syncGatewayModels, ensureGatewayProviderRegistered } = await import("../../core/gateway/gateway-sync.ts");

      const client = new GatewayClient({
        jarvisHome: engine.jarvisHome,
        appVersion: engine.appVersion,
      });

      ensureGatewayProviderRegistered({
        providerRegistry: engine.providerRegistry,
        baseUrl: client.chatBaseUrl,
      });

      const result = await syncGatewayModels({
        client,
        providerRegistry: engine.providerRegistry,
      });
      if (result.ok === false) {
        return c.json({ ok: false, error: result.error }, 502);
      }

      await engine.onProviderChanged();

      return c.json({
        ok: true,
        providerId: GATEWAY_PROVIDER_ID,
        defaultModelId: result.defaultModelId,
        models: result.models,
        imageModels: result.imageModels,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`POST /gateway/sync failed: ${msg}`);
      return c.json({ ok: false, error: msg }, 502);
    }
  });

  return route;
}
