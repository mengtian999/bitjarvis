#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { packDualKindSeed } from "./build-server-artifact.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;
const osDirName = platform === "darwin" ? "mac" : platform === "win32" ? "win" : platform;
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
await packDualKindSeed({
  outDir: path.join(ROOT, "dist-server", `${osDirName}-${arch}`),
  rendererDistDir: path.join(ROOT, "desktop", "dist-renderer"),
  rendererArtifactOutDir: path.join(ROOT, "dist-renderer-artifact"),
  artifactOutDir: path.join(ROOT, "dist-server-artifact", `${osDirName}-${arch}`),
  version: rootPkg.version,
  platform, arch,
});
console.log("[finish-seed-only] Done!");
