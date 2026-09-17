/**
 * DeepSeek Responses provider plugin
 *
 * DeepSeek 官方 endpoint 的 OpenAI Responses 协议通道，与 OpenAI ChatCompletions
 * 通道（./deepseek.ts）是同一厂商的不同接入方式，同 moonshot / kimi-coding 的先例。
 *
 * 为什么单独一个 provider：Responses 与 ChatCompletions 的 effort 枚举、输出预算
 * 字段、思考链回放载体都不同，混在一个 provider 里只能靠用户手改 api 字段，切错
 * 协议时供应商静默忽略参数而不报错。
 *
 * 覆盖范围：V4-Flash 正式版（2026-07-31）起原生支持 Responses。V4-Pro 在官方
 * 文档上的状态是"即将支持"，这里先行登记，以便官方开放当天无需改代码；在那之前
 * 对 Pro 发起的 Responses 请求会被供应商拒绝。
 *
 * 思考档位：Flash 支持 low / high / max 三档，Pro 目前只有 high / max（low 按
 * high 处理）。这是服务端行为，客户端照常发用户选的档位即可。
 *
 * 文档：https://api-docs.deepseek.com/guides/responses_api/
 *       https://api-docs.deepseek.com/zh-cn/api/create-chat-completion
 */

const DEEPSEEK_RESPONSES_MODELS = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    api: "openai-responses",
    context: 1_000_000,
    maxOutput: 384_000,
    image: false,
    reasoning: true,
    xhigh: true,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    api: "openai-responses",
    context: 1_000_000,
    maxOutput: 384_000,
    image: false,
    reasoning: true,
    xhigh: true,
  },
];

/** @type {import('../../core/provider-registry.ts').ProviderPlugin} */
export const deepseekResponsesPlugin = {
  id: "deepseek-responses",
  displayName: "DeepSeek (Responses)",
  authType: "api-key",
  defaultBaseUrl: "https://api.deepseek.com",
  defaultApi: "openai-responses",
  models: DEEPSEEK_RESPONSES_MODELS,
};
