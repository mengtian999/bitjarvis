#!/usr/bin/env node
"use strict";

/**
 * 生成 Microsoft Store 提交专用的 AppxManifest 模板。
 *
 * 为什么要这一步：
 *   electron-builder 的 `appx` 目标里，Identity 的 Version 只能从 package.json 的
 *   version 派生（major.minor.patch.0），没有任何 appx.version 之类的开关可以覆盖。
 *   应用内部版本是 0.0.1，派生出来就是 0.0.1.0，而商店的包编号规则要求
 *   第一段不能为 0、第四段必须为 0。改 package.json 的 version 会牵动运行时版本、
 *   artifact 目录、minShell 比较，代价太大。
 *
 * 做法：
 *   把 electron-builder 自带的模板原样复制一份，只把 ${version} 这一个宏换成显式
 *   钉死的四段版本号，其余宏（identityName / publisher / capabilities / extensions /
 *   minVersion ...）全部保留，交给 electron-builder 正常展开。这样我们不需要维护
 *   一份会漂移的手写清单，模板永远跟着 electron-builder 走。
 *
 * 用法：
 *   node scripts/appx-store-manifest.cjs            # 默认 1.0.0.0
 *   APPX_IDENTITY_VERSION=2.0.0.0 node scripts/appx-store-manifest.cjs
 *
 * 产物：build/appx/AppxManifest.store.xml
 * 配套的 electron-builder 参数：--config.appx.customManifestPath=appx/AppxManifest.store.xml
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_IDENTITY_VERSION = "1.0.0.0";
const VERSION_PATTERN = /^\d+\.\d+\.\d+\.0$/;
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_FILE = path.join(REPO_ROOT, "build", "appx", "AppxManifest.store.xml");

function resolveTemplatePath() {
  const candidates = [
    path.join(REPO_ROOT, "node_modules", "app-builder-lib", "templates", "appx", "appxmanifest.xml"),
  ];
  try {
    candidates.push(
      path.join(path.dirname(require.resolve("app-builder-lib")), "..", "templates", "appx", "appxmanifest.xml"),
    );
  } catch {
    // 直接依赖解析不到时，退回到仓库内 node_modules 的路径
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `找不到 electron-builder 的 appx 模板，已尝试：\n  ${candidates.join("\n  ")}`,
  );
}

function resolveIdentityVersion() {
  const raw = (process.env.APPX_IDENTITY_VERSION || DEFAULT_IDENTITY_VERSION).trim();
  if (!VERSION_PATTERN.test(raw)) {
    throw new Error(
      `APPX_IDENTITY_VERSION 必须是 x.y.z.0 形式的四段版本号（第四段保留给商店，必须为 0），收到："${raw}"`,
    );
  }
  if (Number.parseInt(raw.split(".")[0], 10) === 0) {
    throw new Error(
      `商店的包编号规则要求第一段不能为 0，收到："${raw}"。请改用 1.0.0.0 或更高的单调递增版本。`,
    );
  }
  return raw;
}

function main() {
  const templatePath = resolveTemplatePath();
  const identityVersion = resolveIdentityVersion();
  const template = fs.readFileSync(templatePath, "utf8");

  const occurrences = template.split("${version}").length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `模板 ${templatePath} 里 ${'${version}'} 宏出现 ${occurrences} 次，预期恰好 1 次。electron-builder 可能改过模板，请检查。`,
    );
  }

  const rendered = template.replace(/\$\{version\}/g, identityVersion);
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, rendered, "utf8");

  console.log(`appx 模板:  ${path.relative(REPO_ROOT, templatePath)}`);
  console.log(`输出:       ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  console.log(`Identity:   Version="${identityVersion}"（其余宏由 electron-builder 展开）`);
}

main();