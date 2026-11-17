/**
 * server/routes/cyber-egg.ts — 「赛博鸡蛋」本地代理
 *
 * GET  /api/cyber-egg/feed?force=1  结构化清单
 * POST /api/cyber-egg/refresh       手动刷新（等价于 force=1）
 *
 * 为什么不让渲染层直连远端：
 *   - 渲染层跑在 file:// 源上，直连要处理 CORS 与失败态；
 *   - 本地 server 有 jarvisHome，可以做「远端 → 磁盘缓存 → 随包基线」三级兜底，
 *     断网/远端挂了页面依然是满的，只是标个「数据可能过期」。
 *
 * 缓存策略：内存 5 分钟 + 磁盘持久化；同一时刻只允许一次上游请求（in-flight 合并）。
 */
import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";

import { createModuleLogger } from "../../lib/debug-log.ts";
import {
  CYBER_EGG_DEFAULT_BASE_URL,
  normalizeCyberEggFeed,
  type CyberEggDataOrigin,
  type CyberEggFeed,
} from "../../shared/cyber-egg-contract.ts";
import bundledFallbackJson from "../../shared/cyber-egg-fallback.json" with { type: "json" };

/** 内存缓存 TTL：比远端 5 分钟缓存略短，让「刷新」真的能刷新。 */
const CACHE_TTL_MS = 4 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const DISK_CACHE_FILE = "cyber-egg-feed.json";

type FeedPayload = {
  feed: CyberEggFeed;
  origin: CyberEggDataOrigin;
  fetchedAt: number;
  warning?: string;
};

function resolveBaseUrl(): string {
  const fromEnv = process.env.JARVIS_CYBEREGG_URL?.trim();
  const base = fromEnv || CYBER_EGG_DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

export function createCyberEggRoute(engine: any) {
  const route = new Hono();
  const log = createModuleLogger("api-cyber-egg");

  let memory: FeedPayload | null = null;
  let inflight: Promise<FeedPayload | null> | null = null;
  let lastError = "";

  const diskPath = () => path.join(String(engine.jarvisHome || ""), "cache", DISK_CACHE_FILE);

  async function readDisk(): Promise<CyberEggFeed | null> {
    try {
      const raw = await fs.readFile(diskPath(), "utf8");
      return normalizeCyberEggFeed(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async function writeDisk(feed: CyberEggFeed): Promise<void> {
    try {
      const target = diskPath();
      await fs.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(feed), "utf8");
      await fs.rename(tmp, target);
    } catch (err) {
      // 磁盘缓存只是加速，失败不影响请求
      log.warn(`写入磁盘缓存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function fetchRemote(force: boolean): Promise<FeedPayload | null> {
    const url = `${resolveBaseUrl()}/feed.json${force ? "?refresh=1" : ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        lastError = `远端 ${res.status}`;
        return null;
      }
      const feed = normalizeCyberEggFeed(await res.json());
      if (!feed) {
        lastError = "远端返回的数据不符合契约";
        return null;
      }
      lastError = "";
      return { feed, origin: "live", fetchedAt: Date.now() };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log.warn(`拉取远端失败: ${lastError}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveFeed(force: boolean): Promise<FeedPayload> {
    if (!force && memory && Date.now() - memory.fetchedAt < CACHE_TTL_MS) {
      return memory;
    }

    if (!inflight) {
      inflight = fetchRemote(force).finally(() => {
        inflight = null;
      });
    }
    const remote = await inflight;
    if (remote) {
      memory = remote;
      void writeDisk(remote.feed);
      return remote;
    }

    const disk = await readDisk();
    if (disk) {
      const payload: FeedPayload = {
        feed: disk,
        origin: "disk",
        fetchedAt: Date.now(),
        warning: lastError ? `远端暂时不可用（${lastError}），显示本机上次缓存` : "远端暂时不可用，显示本机上次缓存",
      };
      memory = payload;
      return payload;
    }

    const bundled = normalizeCyberEggFeed(bundledFallbackJson);
    if (bundled) {
      const payload: FeedPayload = {
        feed: bundled,
        origin: "bundled",
        fetchedAt: Date.now(),
        warning: "远端暂时不可用，显示随包内置的基线数据",
      };
      memory = payload;
      return payload;
    }

    // 理论上到不了这里：契约校验都通过才会打包进来
    throw new Error("cyber-egg: 内置基线数据不可用");
  }

  function respond(c: any, payload: FeedPayload) {
    return c.json({
      ok: true,
      feed: payload.feed,
      origin: payload.origin,
      fetchedAt: new Date(payload.fetchedAt).toISOString(),
      ...(payload.warning ? { warning: payload.warning } : {}),
    });
  }

  route.get("/cyber-egg/feed", async (c) => {
    try {
      const force = c.req.query("force") === "1";
      return respond(c, await resolveFeed(force));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`GET /cyber-egg/feed 失败: ${msg}`);
      return c.json({ ok: false, error: msg }, 502);
    }
  });

  route.post("/cyber-egg/refresh", async (c) => {
    try {
      return respond(c, await resolveFeed(true));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`POST /cyber-egg/refresh 失败: ${msg}`);
      return c.json({ ok: false, error: msg }, 502);
    }
  });

  return route;
}