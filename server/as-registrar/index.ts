/**
 * index.ts — as-registrar 独立服务入口
 *
 * 运行：node server/as-registrar/index.ts（环境变量见 config.ts）
 *
 * 独立部署（bitjarvis.chat 侧）：只拷贝 server/as-registrar/ 目录即可，
 * 该目录不 import 项目 lib/，Node >= 22 直接跑（原生 TS 类型剥离）。
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadAsRegistrarConfig } from "./config.ts";
import { createAsRegistrarHandler, type RegistrarResponse } from "./handler.ts";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function startAsRegistrarServer({ config }: { config: ReturnType<typeof loadAsRegistrarConfig>["config"] }) {
  if (!config) throw new Error("startAsRegistrarServer requires a config");
  const handleRequest = createAsRegistrarHandler({ config });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;
    try {
      const rawBody = await readBody(req);
      const headers: Record<string, string | undefined> = {};
      for (const key of Object.keys(req.headers)) {
        const value = req.headers[key];
        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      }
      const result: RegistrarResponse = await handleRequest(req.method || "GET", path, headers, rawBody);
      sendJson(res, result.status, result.body);
    } catch (err: any) {
      sendJson(res, 400, { error: "M_UNKNOWN", detail: err?.message || String(err) });
    }
  });

  return server;
}

async function main() {
  const { config, errors } = loadAsRegistrarConfig();
  if (!config) {
    console.error("[as-registrar] configuration invalid:");
    for (const message of errors) console.error(`  - ${message}`);
    // 用 exitCode 而非 process.exit：Windows 上 exit 会触发 libuv 句柄断言
    process.exitCode = 1;
    return;
  }

  const server = startAsRegistrarServer({ config });
  server.listen(config.port, config.bindHost, () => {
    console.log(`[as-registrar] listening on http://${config.bindHost}:${config.port}`);
    console.log(`[as-registrar] homeserver: ${config.homeserverUrl}`);
    console.log(`[as-registrar] admin room: ${config.adminRoomId}`);
    console.log(`[as-registrar] registration token: ${config.registrationToken ? "required" : "not required (local dev)"}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// 直接执行时启动服务（被 import 时仅导出，供测试/复用）
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("[as-registrar] fatal:", err?.message || err);
    process.exitCode = 1;
  });
}
