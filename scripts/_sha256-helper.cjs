/**
 * _sha256-helper.cjs — 子进程入口：对单个文件计算 sha256，把 hex 摘要写到 stdout。
 *
 * 被 build-server-artifact.mjs 的 spawnSha256File() 调用，与 _pack-tree-helper.cjs
 * 同一动机：种子装箱阶段发生在 npm install / nft trace / 清理之后，父进程
 * （build-server.mjs）在 Windows 上于此处反复出现"事件循环被同步计算占死"
 * （100% CPU、零 I/O、await 永不返回；2026-11-06 Store 打包排查实录——独立
 * 进程对同一文件算同一哈希只要 0.3s）。把哈希也挪进干净子进程，父进程只做
 * 一次 execFileSync 阻塞等待即可。
 *
 * 用法: node _sha256-helper.cjs <filePath>
 */
"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");

const [, , filePath] = process.argv;
if (!filePath) {
  console.error("Usage: node _sha256-helper.cjs <filePath>");
  process.exit(1);
}

const hash = createHash("sha256");
const stream = fs.createReadStream(filePath);
stream.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
stream.on("data", (chunk) => hash.update(chunk));
stream.on("end", () => {
  process.stdout.write(hash.digest("hex"));
});
