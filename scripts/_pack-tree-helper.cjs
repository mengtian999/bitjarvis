/**
 * _pack-tree-helper.cjs — 子进程入口，用于在独立进程中执行 packTree。
 *
 * 被 build-server-artifact.mjs 的 spawnPackTree() 调用。
 * 在独立进程中运行可以避免父进程（build-server.mjs）因 npm install /
 * nft trace / prune 等步骤积累过多文件句柄而触发 Windows EMFILE。
 *
 * 用法: node _pack-tree-helper.cjs <srcDir> <archivePath> [validateThemesDir]
 *   validateThemesDir 可选：装箱前先在该目录跑 Office PDF 字体资产断言
 *   （fail-closed，与主进程原先的校验同源）。字体校验本身要读大量文件，
 *   2026-11-09 重打包时主进程 fd 表已被 server 阶段耗尽，第一条
 *   readFileSync 就 EMFILE——把校验也放进这个干净进程才可信。
 */
"use strict";

const [,, srcDir, archivePath, validateThemesDir] = process.argv;

if (!srcDir || !archivePath) {
  console.error("Usage: node _pack-tree-helper.cjs <srcDir> <archivePath> [validateThemesDir]");
  process.exit(1);
}

const { packTree } = require("../shared/artifact-core/ustar.cjs");

(async () => {
  if (validateThemesDir) {
    const { assertOfficePdfFontAssets } = require("../desktop/src/office-pdf-fonts.cjs");
    assertOfficePdfFontAssets({ themesDir: validateThemesDir });
    console.log(`[pack-tree] child: Office PDF font assets validated (${validateThemesDir})`);
  }
  await packTree(srcDir, archivePath);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
