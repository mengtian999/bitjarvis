/**
 * shared/cyber-egg-contract.ts — 「赛博鸡蛋」数据契约（服务端代理 + 渲染层共用）
 *
 * 数据源头是 AIHOT 的 /free-tokens.md 镜像，由独立服务 cyberegg 解析成
 * schemaVersion=1 的 feed.json（部署在 https://cyberegg.bitjarvis.chat）。
 * 这里只定义契约与运行时守卫，不做任何网络请求：
 *   - server/routes/cyber-egg.ts 用它校验远端 / 磁盘缓存 / 随包基线；
 *   - 渲染层用它做类型收敛，避免把上游字段错误直接崩到 UI。
 */

/** 远端采集服务的默认地址（可用 JARVIS_CYBEREGG_URL 覆盖）。 */
export const CYBER_EGG_DEFAULT_BASE_URL = "https://cyberegg.bitjarvis.chat";

/** 支持的 feed 结构版本；比它大的版本视为不兼容。 */
export const CYBER_EGG_SCHEMA_VERSION = 1;

export type CyberEggGrant = {
  text: string;
  period?: string;
  note?: string;
  cny?: number;
};

export type CyberEggItem = {
  id: string;
  title: string;
  provider: string;
  /** 去重用的归一化平台标识。 */
  providerSlug?: string;
  section: string;
  /** cn = 国内，intl = 国外。 */
  region?: string;
  grant: CyberEggGrant;
  how?: string;
  appliesTo?: string;
  requirements?: string[];
  validity?: string;
  deadline?: string;
  verifiedAt?: string;
  verifiedSource?: string;
  /** verified | stale | unverified */
  verifyStatus?: string;
  difficulty?: number;
  category?: string;
  claimUrl?: string;
  expired?: boolean;
  /** 这条记录出现过的来源：aihot / tokenmost。 */
  sources?: string[];
};

export type CyberEggSourceMeta = {
  key: string;
  name: string;
  url: string;
  ok: boolean;
  itemCount: number;
  fetchedAt?: string;
  error?: string;
};

export type CyberEggCounts = {
  total: number;
  cn: number;
  intl: number;
  both?: number;
};

export type CyberEggSection = {
  key: string;
  title: string;
  declaredCount?: number;
  itemIds?: string[];
};

export type CyberEggSource = {
  name: string;
  url: string;
  markdownUrl?: string;
  attribution: string;
  updatedAt?: string;
};

export type CyberEggFeed = {
  schemaVersion: number;
  source: CyberEggSource;
  sources?: CyberEggSourceMeta[];
  generatedAt: string;
  sourceEtag?: string;
  stale: boolean;
  counts?: CyberEggCounts;
  itemCount: number;
  sections: CyberEggSection[];
  items: CyberEggItem[];
};

/**
 * 服务端代理在远端不可达时补的字段，用来告诉客户端「这份数据是哪来的」。
 * 'live' = 刚从远端拿到；'disk' = 本机上次缓存；'bundled' = 随包基线。
 */
export type CyberEggDataOrigin = "live" | "disk" | "bundled";

export type CyberEggFeedResponse = {
  ok: true;
  feed: CyberEggFeed;
  origin: CyberEggDataOrigin;
  fetchedAt: string;
  /** 远端失败原因，仅在 origin !== 'live' 时出现。 */
  warning?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isItem(value: unknown): value is CyberEggItem {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.title !== "string") return false;
  if (typeof value.provider !== "string" || typeof value.section !== "string") return false;
  return isRecord(value.grant) && typeof (value.grant as Record<string, unknown>).text === "string";
}

/**
 * 宽松但有效的守卫：只校验渲染必需字段。
 * 上游新增字段一律放行（前向兼容），所以我们不校验「没有多余字段」。
 */
export function isCyberEggFeed(value: unknown): value is CyberEggFeed {
  if (!isRecord(value)) return false;
  if (typeof value.schemaVersion !== "number") return false;
  if (value.schemaVersion > CYBER_EGG_SCHEMA_VERSION) return false;
  if (!isRecord(value.source) || typeof (value.source as Record<string, unknown>).name !== "string") return false;
  if (!Array.isArray(value.items) || !value.items.every(isItem)) return false;
  if (!Array.isArray(value.sections)) return false;
  return true;
}

/** 规范化一份 feed：补 itemCount、过滤掉无法渲染的条目。 */
export function normalizeCyberEggFeed(value: unknown): CyberEggFeed | null {
  if (!isCyberEggFeed(value)) return null;
  return {
    ...value,
    itemCount: value.items.length,
    sections: value.sections.filter(
      (s): s is CyberEggSection => isRecord(s) && typeof s.key === "string" && typeof s.title === "string",
    ),
  };
}

/** 周期文案（客户端不再自己判断 daily/monthly）。 */
export function cyberEggPeriodLabelKey(period: string | undefined): string | null {
  switch (period) {
    case "daily":
      return "cyberegg.period.daily";
    case "weekly":
      return "cyberegg.period.weekly";
    case "monthly":
      return "cyberegg.period.monthly";
    case "yearly":
      return "cyberegg.period.yearly";
    case "once":
      return "cyberegg.period.once";
    default:
      return null;
  }
}