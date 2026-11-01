"use strict";

/**
 * update-source.cjs — 桌面端更新源
 *
 * 事实上的发布渠道决定更新源，不需要客户端去猜：
 *   - Windows 商店版：Microsoft Store 负责更新，不读这里的 feed
 *   - Windows 安装包版 / Linux：只走 GitHub Releases
 *
 * 所以 Gitee 镜像已经废弃，地区检测与手动覆盖一并移除：一个永远只有
 * 一个取值的"选择器"不算选择器，留着只会让更新链路多一次注定失败的
 * 请求（Gitee 上没有 channels release）。
 */

const GITHUB_OWNER = "mengtian999";
const GITHUB_REPO = "Bitjarvis";

/**
 * @returns {"github"}
 */
function resolveUpdateSource() {
  return "github";
}

module.exports = {
  GITHUB_OWNER,
  GITHUB_REPO,
  resolveUpdateSource,
};