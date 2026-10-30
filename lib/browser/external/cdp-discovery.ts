/**
 * 外部浏览器 CDP 端点发现。
 *
 * "外部浏览器" = 用户真实登录态的 Chrome / Edge 默认 profile。Jarvis 通过它
 * 自带的 remote debugging WebSocket 端点驱动它，而不是另起一个干净 profile。
 *
 * 三条硬约束（来自 M0 实测）：
 *  1. **绝不硬编码端口**。端口由浏览器自己选（`--remote-debugging-port=0`），
 *     落在 `<user-data-dir>/DevToolsActivePort` 文件里；每次连接都要重读，
 *     因为端口会漂移（浏览器重启、多实例、崩溃后重拉）。
 *  2. **缺失或畸形的文件一律返回 null，不抛异常**。文件可能正在被写入、
 *     可能是上一次运行的残留 —— 调用方按"当前没有可连接端点"处理，而不是
 *     把解析噪声当成崩溃。
 *  3. **只读 DevToolsActivePort**。绝不碰 Cookies / Login Data，也绝不走
 *     `/json/*` HTTP 端点（M0 实测：本进程 `/json/version`、`/json/list`
 *     均 404，WebSocket 是唯一通道）。
 *
 * 本模块是纯函数 + 文件读取，不建立任何连接，因此可以完全在临时目录里
 * 单测（见 tests/browser-external-cdp-discovery.test.ts）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ExternalBrowserChannel = "chrome" | "edge";

export const EXTERNAL_BROWSER_CHANNELS: readonly ExternalBrowserChannel[] = ["chrome", "edge"];

export function isExternalBrowserChannel(value: unknown): value is ExternalBrowserChannel {
  return typeof value === "string"
    && (EXTERNAL_BROWSER_CHANNELS as readonly string[]).includes(value);
}

/** 从 DevToolsActivePort 解出的端点信息。 */
export interface DevToolsEndpoint {
  port: number;
  wsPath: string;
  wsUrl: string;
}

/** 端点 + 它来自哪个浏览器/哪个 profile 目录。 */
export interface DiscoveredCdpEndpoint extends DevToolsEndpoint {
  channel: ExternalBrowserChannel;
  userDataDir: string;
}

const DEVTOOLS_BROWSER_PATH_RE = /^\/devtools\/browser\/[^\s/?#]+$/;

/** 仅接受 loopback 上的 WebSocket 端点：M0 实测端口只绑 127.0.0.1。 */
export function buildBrowserWsUrl(port: number, wsPath: string): string {
  return `ws://127.0.0.1:${port}${wsPath}`;
}

/**
 * 解析 DevToolsActivePort 文件内容。
 *
 * Chrome/Edge 写入两行：第 1 行是实际端口，第 2 行是浏览器级 WebSocket 路径
 * （形如 `/devtools/browser/<uuid>`）。任何不符合该形状的输入 → null。
 */
export function parseDevToolsActivePort(text: unknown): DevToolsEndpoint | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const portLine = lines[0];
  const pathLine = lines[1];
  if (!portLine || !pathLine) return null;
  if (!/^\d+$/.test(portLine)) return null;

  const port = Number(portLine);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!DEVTOOLS_BROWSER_PATH_RE.test(pathLine)) return null;

  return { port, wsPath: pathLine, wsUrl: buildBrowserWsUrl(port, pathLine) };
}

/** 只读 `<userDataDir>/DevToolsActivePort`；缺失/不可读/畸形 → null。 */
export function readDevToolsActivePort(
  userDataDir: string,
  deps: { readFileSync?: (p: string, enc: string) => string } = {},
): DevToolsEndpoint | null {
  const read = deps.readFileSync ?? ((p: string, enc: string) => fs.readFileSync(p, enc as BufferEncoding) as unknown as string);
  if (typeof userDataDir !== "string" || !userDataDir) return null;
  let text: string;
  try {
    text = read(path.join(userDataDir, "DevToolsActivePort"), "utf-8");
  } catch {
    // ENOENT / EACCES / EBUSY：都表示"此刻没有可用端点"，不是错误
    return null;
  }
  return parseDevToolsActivePort(text);
}

/**
 * 各平台默认 user-data-dir。
 *
 * 不需要"探测已安装浏览器"：发现阶段只用它拼出 DevToolsActivePort 的绝对路径，
 * 目录不存在时同样返回 null（见 readDevToolsActivePort）。
 */
export function resolveUserDataDir(args: {
  channel: ExternalBrowserChannel;
  platform?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}): string | null {
  const {
    channel,
    platform = process.platform,
    env = process.env,
    homeDir = os.homedir(),
  } = args;
  if (!isExternalBrowserChannel(channel)) return null;

  // 输出的分隔符跟随被询问的平台，而不是宿主平台：这样跨平台单测、诊断输出
  // 与真实机器上的路径形状一致（在 Windows 上模拟 darwin 也得到 POSIX 路径）。
  if (platform === "win32") {
    const join = path.win32.join;
    const base = env.LOCALAPPDATA || join(homeDir, "AppData", "Local");
    return channel === "chrome"
      ? join(base, "Google", "Chrome", "User Data")
      : join(base, "Microsoft", "Edge", "User Data");
  }

  const join = path.posix.join;
  if (platform === "darwin") {
    const base = join(homeDir, "Library", "Application Support");
    return channel === "chrome"
      ? join(base, "Google", "Chrome")
      : join(base, "Microsoft Edge");
  }
  const base = env.XDG_CONFIG_HOME || join(homeDir, ".config");
  return channel === "chrome"
    ? join(base, "google-chrome")
    : join(base, "microsoft-edge");
}

/**
 * 组合式发现：解析 profile 目录 → 读 DevToolsActivePort → 校验形状。
 *
 * **每次连接前调用一次**，不要缓存结果：端口会漂移。
 * `userDataDir` 显式传入时优先（测试与自定义安装位置用）。
 */
export function discoverCdpEndpoint(args: {
  channel: ExternalBrowserChannel;
  userDataDir?: string | null;
  platform?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  readFileSync?: (p: string, enc: string) => string;
}): DiscoveredCdpEndpoint | null {
  if (!isExternalBrowserChannel(args.channel)) return null;
  const userDataDir = args.userDataDir
    || resolveUserDataDir({
      channel: args.channel,
      platform: args.platform,
      env: args.env,
      homeDir: args.homeDir,
    });
  if (!userDataDir) return null;

  const endpoint = readDevToolsActivePort(userDataDir, { readFileSync: args.readFileSync });
  if (!endpoint) return null;

  return { channel: args.channel, userDataDir, ...endpoint };
}