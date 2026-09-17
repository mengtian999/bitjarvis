/**
 * _pack-tree-helper.cjs — 子进程入口，用于在独立进程中执行 packTree。
 *
 * 被 build-server-artifact.mjs 的 spawnPackTree() 调用。
 * 在独立进程中运行可以避免父进程（build-server.mjs）因 npm install /
 * nft trace / prune 等步骤积累过多文件句柄而触发 Windows EMFILE。
 *
 * 用法: node _pack-tree-helper.cjs <srcDir> <archivePath>
 */
"use strict";

const [,, srcDir, archivePath] = process.argv;

if (!srcDir || !archivePath) {
  console.error("Usage: node _pack-tree-helper.cjs <srcDir> <archivePath>");
  process.exit(1);
}

const { packTree } = require("../shared/artifact-core/ustar.cjs");

packTree(srcDir, archivePath)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
