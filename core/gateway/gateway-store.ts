/**
 * core/gateway/gateway-store.ts — 网关匿名设备身份的本地持久化（技术方案 §1.2）。
 *
 * 与 device-registry.ts 是两回事：那个是 IM/远程访问的设备配对体系；
 * 这个是云端模型网关的匿名额度身份，互不依赖。
 *
 * 存储：jarvisHome/gateway-identity.json，owner-only 写入（shared/secret-fs.ts）。
 * installId 一经生成本机终身不变；token 失效时按同一 installId 重新注册，
 * 服务端幂等轮换 token（额度记录跟随 install_id 对应的设备行，不丢）。
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { writeSecretFileSync } from "../../shared/secret-fs.ts";

export const GATEWAY_IDENTITY_FILE = "gateway-identity.json";
export const GATEWAY_INSTALL_ID_FILE = "gateway-install-id";

export type GatewayIdentity = {
  installId: string;
  deviceId: string;
  token: string;
  region: string; // cn | intl（服务端按 IP 判定，§4.2）
  registeredAt: string;
};

export function loadGatewayIdentity(jarvisHome: string): GatewayIdentity | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(jarvisHome, GATEWAY_IDENTITY_FILE), "utf-8"));
  } catch {
    return null; // 不存在或损坏 → 重新注册
  }
  const id = raw as Partial<GatewayIdentity>;
  if (typeof id?.installId !== "string" || typeof id?.token !== "string" || typeof id?.deviceId !== "string") {
    return null;
  }
  return {
    installId: id.installId,
    deviceId: id.deviceId,
    token: id.token,
    region: typeof id.region === "string" ? id.region : "cn",
    registeredAt: typeof id.registeredAt === "string" ? id.registeredAt : "",
  };
}

export function saveGatewayIdentity(jarvisHome: string, identity: GatewayIdentity): void {
  fs.mkdirSync(jarvisHome, { recursive: true });
  writeSecretFileSync(
    path.join(jarvisHome, GATEWAY_IDENTITY_FILE),
    JSON.stringify(identity, null, 2) + "\n",
  );
}

export function clearGatewayIdentity(jarvisHome: string): void {
  try {
    fs.rmSync(path.join(jarvisHome, GATEWAY_IDENTITY_FILE), { force: true });
  } catch {
    /* 不存在则无事发生 */
  }
}

/**
 * 取本机安装 UUID。installId 独立文件存储、终身不变：
 * token 轮换、身份文件清除（token_invalid 后重注册）都不影响它。
 * 生成即落盘——宁可存在一个"从未完成注册"的孤儿 ID，也不能让换发 token 时换设备身份。
 */
export function resolveInstallId(jarvisHome: string): string {
  const dedicated = readInstallIdFile(jarvisHome);
  if (dedicated) return dedicated;
  const legacy = loadGatewayIdentity(jarvisHome)?.installId;
  const installId = legacy || crypto.randomUUID();
  fs.mkdirSync(jarvisHome, { recursive: true });
  writeSecretFileSync(path.join(jarvisHome, GATEWAY_INSTALL_ID_FILE), installId + "\n");
  return installId;
}

function readInstallIdFile(jarvisHome: string): string | null {
  try {
    const v = fs.readFileSync(path.join(jarvisHome, GATEWAY_INSTALL_ID_FILE), "utf-8").trim();
    return v || null;
  } catch {
    return null;
  }
}

/** 设备信息 hash（§1.2）：稳定、不可逆、不含个人信息的机器指纹摘要。 */
export function deviceInfoHash(): string {
  return crypto
    .createHash("sha256")
    .update(`${process.platform}|${process.arch}|gateway-v1`)
    .digest("hex")
    .slice(0, 32);
}
