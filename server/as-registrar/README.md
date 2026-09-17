# as-registrar — Jarvis AppService 自助注册服务

部署在 homeserver（bitjarvis.chat）侧的小型独立服务。通过 **Tuwunel admin room 热注册**
完成 AppService 注册：生成 registration YAML → 用 admin 账号向 admin room 发送
`!admin appservices register` + YAML 围栏代码块 → Tuwunel 持久化并立即生效（无需重启）。

自包含：本目录不 import 项目 `lib/`，`Node >= 22` 直接运行（原生 TS 类型剥离）。

## 运行

```bash
HOMESERVER_URL=https://bitjarvis.chat \
ADMIN_ACCESS_TOKEN=syt_xxx \
ADMIN_ROOM_ID='!adminRoomId:bitjarvis.chat' \
AS_REGISTRAR_TOKEN=$(openssl rand -hex 32) \
REGISTRATION_TOKEN=$(openssl rand -hex 32) \
node server/as-registrar/index.ts
```

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `HOMESERVER_URL` | ✅ | Matrix CS API base（本地 `http://127.0.0.1:8008`） |
| `ADMIN_ACCESS_TOKEN` | ✅ | admin 账号 access token（发 admin room 消息） |
| `ADMIN_ROOM_ID` | ✅ | admin room 的 roomId（部署时把 admin 账号拉进去） |
| `AS_REGISTRAR_TOKEN` | ✅ | 本服务 HTTP 鉴权 Bearer 令牌 |
| `REGISTRATION_TOKEN` | — | Jarvis 首次绑定凭证；未设置则不校验（本地开发） |
| `PORT` | — | 默认 8797 |
| `BIND_HOST` | — | 默认 127.0.0.1（生产走反向代理时保持默认） |

> **桌面端零配置**：Jarvis 桌面端出厂内置 `REGISTRAR_URL=https://bitjarvis.chat`、
> `AS_REGISTRAR_TOKEN`、`REGISTRATION_TOKEN`（见 `server/routes/matrix-bind.ts` 的
> `DEFAULT_MATRIX_*` 常量），用户无需填写任何凭证。上表 env 仅在**部署 registrar
> 服务本身**或**自建服务器覆盖默认值**时需要。

## API

### `POST /_jarvis/appservice/register`

```bash
curl -X POST http://127.0.0.1:8797/_jarvis/appservice/register \
  -H "Authorization: Bearer $AS_REGISTRAR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nodeId": "home3f2a", "senderLocalpart": "jarvis_home3f2a"}'
```

响应：

```json
{
  "registrationId": "jarvis_node_home3f2a",
  "nodeSuffix": "home3f2a",
  "asToken": "…",
  "hsToken": "…",
  "senderLocalpart": "jarvis_home3f2a",
  "homeserverUrl": "https://bitjarvis.chat",
  "adminEventId": "$…",
  "note": "registered via admin room; same id replaces previous registration"
}
```

- 命名空间正则：`@.*_home3f2a`（exclusive），覆盖该节点全部 Agent 虚拟用户
- 相同 `registrationId` 重复注册会被 Tuwunel **幂等替换**（旧 as_token 随即失效）
- `GET /healthz` 健康检查

## Poll 模式链路验证（P1）

先启动 Tuwunel + 本服务，然后：

```bash
HOMESERVER_URL=http://127.0.0.1:8008 \
REGISTRAR_URL=http://127.0.0.1:8797 \
REGISTRAR_TOKEN=$AS_REGISTRAR_TOKEN \
NODE_ID=home3f2a \
SENDER_LOCALPART=jarvis_home3f2a \
INVITE_USER=@alice:bitjarvis.chat \
node server/as-registrar/verify-poll-mode.mjs
```

依次验证：① 虚拟用户注册（`m.login.application_service`）② `as_token + ?user_id=` 走
`/sync` ③ 代虚拟用户建房间/发消息 ④ `/sync` 收到消息（Poll 闭环）。
