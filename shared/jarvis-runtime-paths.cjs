const os = require("os");
const path = require("path");

function expandHome(input, homeDir = os.homedir()) {
  if (!input) return input;
  if (input === "~") return homeDir;
  if (input.startsWith("~/") || input.startsWith("~" + path.sep)) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}

function resolveJarvisHome(input, homeDir = os.homedir()) {
  const raw = input || process.env.JARVIS_HOME || process.env.JARVIS_HOME || path.join(homeDir, ".jarvis");
  return path.resolve(expandHome(raw, homeDir));
}

function assertJarvisHome(jarvisHome, caller) {
  if (!jarvisHome || typeof jarvisHome !== "string") {
    throw new Error(`${caller}: jarvisHome is required`);
  }
}

function resolveJarvisPiSdkRuntimeRoot(jarvisHome) {
  assertJarvisHome(jarvisHome, "resolveJarvisPiSdkRuntimeRoot");
  return path.join(jarvisHome, "runtime", "pi-sdk");
}

function resolveJarvisPiSdkManagedBinDir(jarvisHome) {
  return path.join(resolveJarvisPiSdkRuntimeRoot(jarvisHome), "bin");
}

function resolveJarvisPiSdkResourceLoaderCwd(jarvisHome) {
  return path.join(resolveJarvisPiSdkRuntimeRoot(jarvisHome), "resource-loader", "project");
}

function resolveJarvisPiSdkResourceLoaderAgentDir(jarvisHome) {
  return path.join(resolveJarvisPiSdkRuntimeRoot(jarvisHome), "resource-loader", "agent");
}

function resolveLegacyPiSdkManagedBinDir(jarvisHome) {
  assertJarvisHome(jarvisHome, "resolveLegacyPiSdkManagedBinDir");
  return path.join(jarvisHome, ".pi", "agent", "bin");
}

module.exports = {
  resolveJarvisHome,
  resolveJarvisPiSdkManagedBinDir,
  resolveJarvisPiSdkResourceLoaderAgentDir,
  resolveJarvisPiSdkResourceLoaderCwd,
  resolveJarvisPiSdkRuntimeRoot,
  resolveLegacyPiSdkManagedBinDir,
};
