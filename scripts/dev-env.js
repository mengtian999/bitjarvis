import { homedir } from "node:os";
import { join } from "node:path";

export function defaultDevJarvisHome() {
  return join(homedir(), ".jarvis-dev");
}

export function applyDevEnvironment(env = process.env, {
  nodeBin = process.execPath,
} = {}) {
  env.JARVIS_HOME = defaultDevJarvisHome();
  env.JARVIS_HOME = defaultDevJarvisHome();
  env.JARVIS_DEV_NODE_BIN = nodeBin;
  return env;
}
