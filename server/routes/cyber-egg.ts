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
const DISK_CACHE_PREFIX = "cyber-egg-feed";

/**
 * 远端已经是「按语言分端点」了（/feed.json?lang=en 只带一种语言的文案），
 * 所以本地缓存也必须按语言分开存：切语言时不能拿到上一门语言的快照。
 */
function normalizeLang(raw: string): string {
  const v = (raw || "").trim().toLowerCase();
  switch (v) {
    case "zh":
    case "zh-cn":
    case "zh-hans":
      return "zh-CN";
    case "zh-tw":
    case "zh-hk":
    case "zh-hant":
      return "zh-TW";
    case "en":
    case "ja":
    case "ko":
    case "fr":
    case "de":
      return v;
    default:
      return "zh-CN";
  }
}

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

  const memory = new Map<string, FeedPayload>();
  const inflight = new Map<string, Promise<FeedPayload | null>>();
  let lastError = "";

  const diskPath = (lang: string) =>
    path.join(String(engine.jarvisHome || ""), "cache", `${DISK_CACHE_PREFIX}-${lang}.json`);

  async function readDisk(lang: string): Promise<CyberEggFeed | null> {
    try {
      const raw = await fs.readFile(diskPath(lang), "utf8");
      return normalizeCyberEggFeed(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async function writeDisk(lang: string, feed: CyberEggFeed): Promise<void> {
    try {
      const target = diskPath(lang);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(feed), "utf8");
      await fs.rename(tmp, target);
    } catch (err) {
      // 磁盘缓存只是加速，失败不影响请求
      log.warn(`写入磁盘缓存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function fetchRemote(force: boolean, lang: string): Promise<FeedPayload | null> {
    const query = new URLSearchParams({ lang });
    if (force) query.set("refresh", "1");
    const url = `${resolveBaseUrl()}/feed.json?${query.toString()}`;
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

  async function resolveFeed(force: boolean, lang: string): Promise<FeedPayload> {
    const cached = memory.get(lang);
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached;
    }

    let pending = inflight.get(lang);
    if (!pending) {
      pending = fetchRemote(force, lang).finally(() => {
        inflight.delete(lang);
      });
      inflight.set(lang, pending);
    }
    const remote = await pending;
    if (remote) {
      memory.set(lang, remote);
      void writeDisk(lang, remote.feed);
      return remote;
    }

    const disk = await readDisk(lang);
    if (disk) {
      const payload: FeedPayload = {
        feed: disk,
        origin: "disk",
        fetchedAt: Date.now(),
        warning: lastError ? `远端暂时不可用（${lastError}），显示本机上次缓存` : "远端暂时不可用，显示本机上次缓存",
      };
      memory.set(lang, payload);
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
      memory.set(lang, payload);
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
      return respond(c, await resolveFeed(force, normalizeLang(c.req.query("lang") || "")));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`GET /cyber-egg/feed 失败: ${msg}`);
      return c.json({ ok: false, error: msg }, 502);
    }
  });

  route.post("/cyber-egg/refresh", async (c) => {
    try {
      return respond(c, await resolveFeed(true, normalizeLang(c.req.query("lang") || "")));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`POST /cyber-egg/refresh 失败: ${msg}`);
      return c.json({ ok: false, error: msg }, 502);
    }
  });

  return route;
}