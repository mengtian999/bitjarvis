/**
 * config.ts — as-registrar 环境变量配置
 *
 * 本地开发与生产用同一份代码，仅环境变量不同：
 *   HOMESERVER_URL       Matrix CS API base（如 http://127.0.0.1:8008 或 https://bitjarvis.chat）
 *   ADMIN_ACCESS_TOKEN   admin 账号 access token（发 admin room 消息用）
 *   ADMIN_ROOM_ID        admin room 的 roomId（!xxx:server，部署时把 admin 拉进去）
 *   AS_REGISTRAR_TOKEN   本服务自身的 HTTP 鉴权 Bearer 令牌
 *   REGISTRATION_TOKEN   （可选）Jarvis 首次绑定时须出示的令牌；未设置则不校验（本地开发）
 *   PORT                 （可选）监听端口，默认 8797
 *   BIND_HOST            （可选）监听地址，默认 127.0.0.1（生产用反向代理时保持默认）
 */

export interface AsRegistrarConfig {
  homeserverUrl: string;
  adminAccessToken: string;
  adminRoomId: string;
  registrarToken: string;
  registrationToken: string | null;
  port: number;
  bindHost: string;
}

const DEFAULT_PORT = 8797;

export function loadAsRegistrarConfig(env: Record<string, string | undefined> = process.env): {
  config: AsRegistrarConfig | null;
  errors: string[];
} {
  const errors: string[] = [];
  const required = (name: string): string => {
    const value = (env[name] || "").trim();
    if (!value) errors.push(`missing required env: ${name}`);
    return value;
  };

  const homeserverUrl = required("HOMESERVER_URL").replace(/\/+$/, "");
  if (homeserverUrl && !/^https?:\/\//i.test(homeserverUrl)) {
    errors.push(`HOMESERVER_URL must be an http(s) URL, got: "${homeserverUrl}"`);
  }
  const adminAccessToken = required("ADMIN_ACCESS_TOKEN");
  const adminRoomId = required("ADMIN_ROOM_ID");
  if (adminRoomId && !adminRoomId.startsWith("!")) {
    errors.push(`ADMIN_ROOM_ID must be a roomId starting with "!", got: "${adminRoomId}"`);
  }
  const registrarToken = required("AS_REGISTRAR_TOKEN");
  const registrationTokenRaw = (env["REGISTRATION_TOKEN"] || "").trim();
  const portRaw = (env["PORT"] || "").trim();
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    errors.push(`PORT must be a valid port number, got: "${portRaw}"`);
  }

  if (errors.length) return { config: null, errors };

  return {
    config: {
      homeserverUrl,
      adminAccessToken,
      adminRoomId,
      registrarToken,
      registrationToken: registrationTokenRaw || null,
      port,
      bindHost: (env["BIND_HOST"] || "127.0.0.1").trim() || "127.0.0.1",
    },
    errors,
  };
}
