#!/usr/bin/env node
/**
 * scripts/pack-seed.mjs
 *
 * Runs just the packDualKindSeed step (server + renderer archive packing,
 * manifest creation, signing, and verification) without rebuilding the
 * server tree. The dist-server tree should already be built.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { packDualKindSeed } from "./build-server-artifact.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const platform = process.platform;
const arch = process.arch;

const osDirName = platform === "darwin" ? "mac" : platform === "win32" ? "win" : platform;

console.log(`[pack-seed] Packaging seed for ${platform}-${arch}, version ${version}`);

const result = await packDualKindSeed({
  outDir: path.join(ROOT, "dist-server", `${osDirName}-${arch}`),
  rendererDistDir: path.join(ROOT, "desktop", "dist-renderer"),
  rendererArtifactOutDir: path.join(ROOT, "dist-renderer-artifact"),
  artifactOutDir: path.join(ROOT, "dist-server-artifact", `${osDirName}-${arch}`),
  version,
  platform,
  arch,
});

console.log("[pack-seed] Seed kit created successfully:");
console.log(`  server:  ${result.serverArchivePath}`);
console.log(`  renderer: ${result.rendererArchivePath}`);
console.log(`  manifest: ${result.manifestPath}`);
console.log(`  signature: ${result.sigPath}`);
