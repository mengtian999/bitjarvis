# 浏览器后端

Jarvis 的浏览器工具（`browser`）有两个后端，由设置里的「目标浏览器」决定：

| 后端 | 说明 |
|------|------|
| `embedded`（默认） | 在 Jarvis 内用隔离 profile 运行的内嵌浏览器（Electron `WebContentsView`）。Cookie、登录态、站点数据都与你的日常浏览器隔离。 |
| `system` | 你本机真实登录态的 Chrome / Edge。Jarvis 通过浏览器自带的 remote debugging WebSocket 端点（CDP）驱动它，所以 Agent 看到的就是你平时看到的页面和登录状态。 |

`backend` 存在跨端共享的浏览器偏好里（`shared/browser-preferences.ts`，默认 `embedded`）。会话在启动时**固化**自己用的后端：中途改设置不会影响已经在跑的会话。

## 开启系统浏览器

1. 在浏览器里开启远程调试：打开 `chrome://inspect/#remote-debugging`（Edge 打开 `edge://inspect`），把开关打开。
2. 设置 → 浏览器 → 「目标浏览器」，选择「我的 Chrome / Edge（已登录）」。
3. 首次连接时浏览器会弹一个授权提示，点「允许」。Jarvis 不会替你去点这个提示。
4. 点「检查连接」可以确认端点是否已经就绪：它按通道（`chrome` / `edge`）分别返回当前是否找到调试端点，纯文件读取，不建立任何连接。

## 实现约束

系统浏览器后端每次连接前都会重新做一遍发现，并且只做这些事：

- **绝不硬编码端口。** 端口由浏览器自己选，写在 `<user-data-dir>/DevToolsActivePort` 里；每次连接前重新读，因为端口会漂移（重启、多实例、崩溃重拉）。
- **只读 `DevToolsActivePort`。** 不碰 `Cookies`、`Login Data`，也不走 `/json/*` HTTP 端点（本进程里这些端点不可用，WebSocket 是唯一通道）。
- **只连 loopback。** 端点固定解析为 `ws://127.0.0.1:<port>/...`。
- **文件缺失或畸形一律当作「当前没有可连接端点」**，返回 `null` 而不是抛异常——残留文件和写入中的文件都不该被当成崩溃。

## 授权与可见性

Agent 在系统浏览器上做的每一件事，都走和内嵌浏览器同一套授权与审计：

- **动作分级。** 每个动作经 `sessionPermission` 分类：`snapshot` / `screenshot` / `scroll` / `wait` / `show` 是 `read`，`start` / `stop` 是 `routine`，其余（`navigate`、`click`、`type`、`select`、`key`、`evaluate`）是 `review`——按当前会话的权限模式决定是否需要你逐次确认。
- **可核对的评审目标。** `navigate` 会带上规范化后的目标 URL，`click` / `type` / `select` / `key` / `evaluate` 会带上精确的 `tabId`：你确认时看到的是「对哪个标签、做什么」。
- **动作日志。** 每个会话保留最近 200 条动作记录（`action`、脱敏后的参数摘要、结果、当时的 URL），最多保留 20 个会话，供回看纠错。
- **不可用必须带原因。** 会话一旦不可用，`getBrowserSessionStates()` 的 `unavailableReason` 一定附带可操作的原因（`browser_status` 事件也会以 `error` 字段透出），而不是一个空状态。

## 拒绝清单

以下是系统浏览器后端**明确不做**的事。这些不是「暂时还没做」，是有意为之：

1. **不清除你真实浏览器的 Cookie 与站点数据。** 「清除 Cookies」只对内嵌浏览器有效；系统后端下调用会直接报错：*"Clearing cookies and site data is only available for the embedded browser. Your system browser's data is never touched by Jarvis."*
2. **不关闭你自己的标签页。** Jarvis 只关闭它自己开出来的标签页（`owned`）；你的标签页在会话结束或挂起时只做 detach，页面原样留在浏览器里。
3. **挂起（suspend）不关任何标签页**，无论是否 owned——页面都还给你。
4. **不替你点浏览器的授权提示。** 等不到授权就以 `BROWSER_EXTERNAL_AWAITING_AUTH` / `BROWSER_EXTERNAL_AUTH_TIMEOUT` 失败，而不是想办法绕过去。
5. **未知命令一律明确失败。** 外部后端没有的命令返回 `BROWSER_EXTERNAL_UNSUPPORTED`——宁可明确报错，也不静默吞掉 Agent 的动作。
6. **沿用内嵌浏览器同一套 URL 白名单。** 被策略拦下的 URL 直接报错，不因为「这是用户自己的浏览器」就放宽。
7. **不给插件提供浏览器控制接口。** 插件不要自建 ad hoc 的浏览器控制 route（见 [`PLUGIN_SDK.md`](PLUGIN_SDK.md)）；驱动登录态站点是 Agent 工具的事。

连接 / 授权类错误（`BROWSER_EXTERNAL_NOT_RUNNING`、`_CONNECT_FAILED`、`_AWAITING_AUTH`、`_AUTH_TIMEOUT`、`_DISCONNECTED`）是**会话级致命**的：该会话后续任何动作都不可能完成，会被标为不可用并给出原因。`BROWSER_EXTERNAL_UNSUPPORTED` 与命令超时只是单条命令失败，不会拖垮整个会话。

## 代码位置

- 后端分流与偏好：`lib/browser/browser-manager.ts`（`_backendForSession`、`_getExternalBackend`、`clearBrowserCookiesAndSiteData`）
- 外部后端实现：`lib/browser/external/external-backend.ts`
- 端点发现：`lib/browser/external/cdp-discovery.ts`
- CDP 客户端与页面脚本：`lib/browser/external/cdp-client.ts`、`lib/browser/external/page-script.ts`
- 偏好与路由：`shared/browser-preferences.ts`、`server/routes/preferences.ts`