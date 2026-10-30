"use strict";

/**
 * update-source.cjs — 更新源地区检测与手动覆盖
 *
 * 三层决策：
 *   1. preferences.json 里 update_source 显式写了 "github" / "gitee" → 直接用
 *   2. 系统时区落在大陆时区 → gitee
 *   3. 其余 → github
 *
 * 只负责"选哪个源"，不负责怎么拉。auto-updater.cjs 和 ota-core.cjs 各自
 * 拿到结果后走自己的下载逻辑。
 */

const GITHUB_OWNER = "mengtian999";
const GITHUB_REPO = "Bitjarvis";
const GITEE_OWNER = "dreamsky111333";
const GITEE_REPO = "bitjarvis";

// 大陆时区——香港/台北不在此列，它们走 github
const CN_TIMEZONES = new Set([
  "Asia/Shanghai",
  "Asia/Urumqi",
  "Asia/Chongqing",
  "Asia/Harbin",
  "Asia/Chungking",
  "PRC",
]);

/**
 * 检测地区。只看时区，不看 IP——客户端离线也能判断，不引入网络延迟。
 * @returns {"cn" | "global"}
 */
function detectRegion() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && CN_TIMEZONES.has(tz)) return "cn";
  } catch {}
  return "global";
}

/**
 * 读 preferences.json 的 update_source 字段。
 * @param {object|null|undefined} prefs — 已解析的 preferences.json
 * @returns {"github" | "gitee" | "auto"}
 */
function readUpdateSourcePreference(prefs) {
  const val = prefs && prefs.update_source;
  if (val === "github" || val === "gitee") return val;
  return "auto";
}

/**
 * 最终决策：手动覆盖 > 时区检测 > 默认 github。
 * @param {object|null|undefined} prefs
 * @returns {"github" | "gitee"}
 */
function resolveUpdateSource(prefs) {
  const pref = readUpdateSourcePreference(prefs);
  if (pref !== "auto") return pref;
  return detectRegion() === "cn" ? "gitee" : "github";
}

module.exports = {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITEE_OWNER,
  GITEE_REPO,
  CN_TIMEZONES,
  detectRegion,
  readUpdateSourcePreference,
  resolveUpdateSource,
};
