/**
 * _nft-trace-helper.mjs — 子进程入口：在干净进程里跑 @vercel/nft trace。
 *
 * 被 build-server-phases.mjs 的 pruneServerNodeModulesViaNft() 调用，与
 * _pack-tree-helper.cjs 同一思路：把会累积文件句柄的重 fs 阶段隔离进拥有
 * 独立 fd 表的子进程。nft 遍历数百个包 / 数万文件，且内部带 worker 线程池
 * ——线程与主进程共享 fd 表，一旦 trace 中途抛错（EBUSY / EPERM 都出现过，
 * 例如扫到正在运行的 Jarvis 应用锁着的 profile 文件），错误路径上未关闭的
 * 句柄就滞留在主进程里，把后面随便哪一步 readFileSync 打成 EMFILE
 * （2026-11-09/10 重打包实测，报错位置会在 seed 各阶段之间漂移）。
 * 子进程退出后 OS 回收它的全部句柄，父进程不再受污染。
 *
 * 用法: node _nft-trace-helper.mjs <outDir> <rootsJsonPath> <resultJsonPath>
 *   outDir          server 输出树（nft 的 base）
 *   rootsJsonPath   JSON 数组：nft 入口文件绝对路径列表
 *   resultJsonPath  成功时写出 { fileList: string[] }
 *
 * 退出码：0 = trace 成功且结果已写出；非 0 = trace 失败（父进程按既有约定
 * 记 warn 并跳过 prune）。
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

const [,, outDir, rootsJsonPath, resultJsonPath] = process.argv;
if (!outDir || !rootsJsonPath || !resultJsonPath) {
  console.error("Usage: node _nft-trace-helper.mjs <outDir> <rootsJsonPath> <resultJsonPath>");
  process.exit(1);
}

// 与 build-server-phases.mjs 原 readNftTraceSource 保持一致：bundled 插件以
// TypeScript 源码形式留在包内、由插件运行时加载；nft 解析器只认 JS，这里
// 提供只读转译视图，包内文件保持原样。
async function readNftTraceSource(filePath) {
  let source;
  try {
    source = await fs.promises.readFile(filePath, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return null;
    throw error;
  }
  if (!/\.(?:cts|mts|tsx?|d\.ts)$/i.test(filePath)) return source;
  return ts.transpileModule(source, {
    fileName: filePath,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  }).outputText;
}

const roots = JSON.parse(fs.readFileSync(rootsJsonPath, "utf-8"));
const { nodeFileTrace } = await import("@vercel/nft");

const { fileList } = await nodeFileTrace(roots, {
  base: outDir,
  conditions: ["node", "import"],
  readFile: readNftTraceSource,
});

fs.writeFileSync(resultJsonPath, JSON.stringify({ fileList: [...fileList] }));
console.log(`[nft-trace] child traced ${fileList.size} files`);
process.exit(0);
