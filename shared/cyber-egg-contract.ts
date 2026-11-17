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

/**
 * 一条记录在某种语言下的展示文案（cyberegg 侧用机器翻译生成并缓存）。
 * 缺字段时渲染层一律回落到 CyberEggItem 上的中文字段，不会出现空白卡片。
 */
export type CyberEggItemText = {
  title?: string;
  grantText?: string;
  grantNote?: string;
  how?: string;
  appliesTo?: string;
  validity?: string;
  requirements?: string[];
  category?: string;
  verifiedSource?: string;
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
  /**
   * 这份额度能不能直接当通用 API 用（不是只能在厂商自家产品里花）。
   * 由 cyberegg 端按各来源的权威字段判定（tokenmost 的 api_via、AIHOT 的门槛 chip），
   * 客户端的「能当API用」筛选只认这个字段，不自己猜文案。
   */
  apiUsable?: boolean;
  claimUrl?: string;
  /** 上游原本给的入口链接（被固定邀请链接覆盖前的样子），仅用于溯源。 */
  sourceUrl?: string;
  expired?: boolean;
  /** 这条记录出现过的来源：aihot / tokenmost。 */
  sources?: string[];
  /**
   * 多语言文案：key 为 zh-TW / en / ja / ko / fr / de。
   * 简体中文直接用上面的中文字段，没有 i18n 键。
   */
  i18n?: Record<string, CyberEggItemText>;
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

/**
 * 网页版支持的语言代码，和 cyberegg 服务的 `?lang=` 取值一一对应
 * （见服务端 web_i18n.go 里的 langs）。
 */
export const CYBER_EGG_WEB_LANGS = ["zh", "zh-TW", "en", "ja", "ko", "fr", "de"] as const;

export type CyberEggWebLang = (typeof CYBER_EGG_WEB_LANGS)[number];

/**
 * 把桌面端的 locale 收敛成网页版认的语言代码。
 * 桌面端只发 7 种语言，这里仍然按前缀匹配，认不出来的回落到简体中文。
 */
export function cyberEggWebLang(locale?: string | null): CyberEggWebLang {
  const raw = (locale || "").trim().toLowerCase().replace(/_/g, "-");
  if (!raw) return "zh";
  if (raw.startsWith("zh")) {
    return /(?:tw|hk|mo|hant)/.test(raw) ? "zh-TW" : "zh";
  }
  switch (raw.slice(0, 2)) {
    case "en":
      return "en";
    case "ja":
      return "ja";
    case "ko":
      return "ko";
    case "fr":
      return "fr";
    case "de":
      return "de";
    default:
      return "zh";
  }
}

/**
 * 网页版赛博鸡蛋地址：桌面端菜单点击后直接用系统浏览器打开这里，
 * 不再在应用内渲染一份页面（内置页面会占住 currentTab，侧栏点会话没反应）。
 *
 * 带上 lang 让网页版和桌面端当前语言保持一致；网页版自己也会按
 * Accept-Language 兜底，所以参数丢了也不会说错语言。
 */
export function cyberEggWebUrl(locale?: string | null): string {
  return `${CYBER_EGG_DEFAULT_BASE_URL}/?lang=${encodeURIComponent(cyberEggWebLang(locale))}`;
}
