#!/usr/bin/env node
/**
 * scripts/sync-cyber-egg-baseline.mjs — 把线上「赛博鸡蛋」清单同步成随包基线
 *
 * 桌面端赛博鸡蛋页的数据是三级兜底：
 *   远端 /feed.json  →  jarvisHome/cache/cyber-egg-feed-<lang>.json  →  shared/cyber-egg-fallback.json
 * 前两级运行时自己会更新，只有「随包基线」是仓库里的静态文件。上游数据或文案一变，
 * 就得跑一次本脚本，否则断网/远端挂掉时桌面端显示的还是一份旧清单：
 *
 *   npm run sync:cyber-egg                 # 拉线上清单覆盖基线
 *   npm run sync:cyber-egg -- --dry-run    # 只比对差异，不写文件
 *   npm run sync:cyber-egg -- --base=https://example.com
 *
 * 基线只存简体中文：运行时简体直接读中文字段，其余语言由远端 feed 的 i18n 字段提供，
 * 因此这里固定请求 lang=zh-CN，不再按语言拆成多份（会把安装包撑大却没人用）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CYBER_EGG_DEFAULT_BASE_URL,
  normalizeCyberEggFeed,
} from "../shared/cyber-egg-contract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(ROOT, "shared", "cyber-egg-fallback.json");
const TIMEOUT_MS = 20_000;

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run") || argv.includes("-n");
  const baseFromFlag = argv.find((a) => a.startsWith("--base="))?.slice("--base=".length);
  const base = (baseFromFlag || process.env.JARVIS_CYBEREGG_URL || CYBER_EGG_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { dryRun, base };
}

async function readExisting() {
  try {
    const raw = await fs.readFile(TARGET, "utf8");
    return normalizeCyberEggFeed(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function fetchLive(base) {
  const url = `${base}/feed.json?lang=zh-CN`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    const feed = normalizeCyberEggFeed(await res.json());
    if (!feed) throw new Error(`${url} 返回的数据不符合 cyber-egg 契约`);
    return feed;
  } finally {
    clearTimeout(timer);
  }
}

function summarize(feed) {
  const cn = feed.items.filter((i) => i.region === "cn").length;
  const intl = feed.items.filter((i) => i.region === "intl").length;
  const apiUsable = feed.items.filter((i) => i.apiUsable).length;
  const failedSources = (feed.sources ?? []).filter((s) => s.ok === false).map((s) => s.key);
  return {
    items: feed.items.length,
    cn,
    intl,
    apiUsable,
    sections: feed.sections.length,
    sourceUpdatedAt: feed.source?.updatedAt ?? "",
    generatedAt: feed.generatedAt ?? "",
    failedSources,
  };
}

const { dryRun, base } = parseArgs(process.argv.slice(2));
const before = await readExisting();
const live = await fetchLive(base);
const after = summarize(live);
const prev = before ? summarize(before) : null;

console.log(`[sync:cyber-egg] 远端 ${base}`);
if (prev) {
  console.log(
    `[sync:cyber-egg] 基线 → ${prev.items} 条（国内 ${prev.cn} / 国外 ${prev.intl} / 能当API用 ${prev.apiUsable}） · ${prev.sourceUpdatedAt || "无时间戳"}`,
  );
} else {
  console.log("[sync:cyber-egg] 基线 → 不存在或已损坏，将新建");
}
console.log(
  `[sync:cyber-egg] 线上 → ${after.items} 条（国内 ${after.cn} / 国外 ${after.intl} / 能当API用 ${after.apiUsable}） · ${after.sourceUpdatedAt || "无时间戳"}`,
);
if (after.failedSources.length > 0) {
  console.warn(`[sync:cyber-egg] 注意：本次有几个上游没抓成功（${after.failedSources.join(", ")}），基线会缺少它们的条目`);
}
if (after.items === 0) {
  console.warn("[sync:cyber-egg] 线上清单是空的，拒绝用它覆盖基线");
  process.exit(1);
}

if (dryRun) {
  console.log("[sync:cyber-egg] --dry-run：不写文件");
  process.exit(0);
}

const payload = JSON.stringify(live);
await fs.writeFile(TARGET, payload, "utf8");
console.log(`[sync:cyber-egg] 已写入 ${path.relative(ROOT, TARGET)}（${payload.length} 字节）`);
