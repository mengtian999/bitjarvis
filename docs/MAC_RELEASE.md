# macOS 云发布与上线准备

桌面端 Mac 包走 **GitHub Releases 外发 DMG（Developer ID 签名 + Apple 公证）**，不是 Mac App Store。  
云打包入口：Actions → **macOS Release**（[`.github/workflows/mac-release.yml`](../.github/workflows/mac-release.yml)），触发方式对齐移动端 iOS 的 `workflow_dispatch`。

## 与 iOS 云打包的差异

| | iOS（`jarvis` 仓库 `ios-appstore.yml`） | 桌面 macOS（本仓库 `mac-release.yml`） |
|---|---|---|
| 证书 | **Apple Distribution** + Provisioning Profile | **Developer ID Application**（`.p12`） |
| 产物 | IPA → App Store Connect / TestFlight | DMG + ZIP → GitHub Releases |
| 公证 | 走 ASC / Transporter | `scripts/notarize.cjs`（`APPLE_ID` + App 专用密码） |
| Bundle | `com.bitjarvis.app` 等 | `com.jarvis.app`（`package.json` `build.appId`） |
| Seed 签名 | 无 | 必须：`JARVIS_SIGN_KEY`（与 Linux Release 同源） |

本机钥匙串里的 **Apple Distribution** 只能打 App Store / MAS，**不能**替代 Developer ID 做外发公证。

## Secrets 缺口核对（上线前）

无法在本机直接枚举远程 Actions Secrets 时，按下表人工核对。  
Linux Release 已引用 `JARVIS_SIGN_KEY`，该密钥**很可能已存在**；其余 macOS 专用项为新增，缺一则云打包会在对应步骤失败。

| Secret | 推断状态 | 备注 |
|---|---|---|
| `JARVIS_SIGN_KEY` | 可能已有 | 与 [linux-release.yml](../.github/workflows/linux-release.yml) 同源 |
| `MAC_DEVELOPER_ID_P12_BASE64` | **需新增** | 非 Apple Distribution；需 Developer ID Application |
| `MAC_DEVELOPER_ID_P12_PASSWORD` | **需新增** | |
| `MAC_CSC_IDENTITY_NAME` | 可选 | 不设则自动选取 |
| `APPLE_ID` | **需新增** | 公证 |
| `APPLE_APP_SPECIFIC_PASSWORD` | **需新增** | 公证 |
| `APPLE_TEAM_ID` | **需新增** | 公证 |
| `KEYCHAIN_PASSWORD` | **需新增** | CI 临时钥匙串 |

本机钥匙串现状（开发机）：常见为 Apple Development / Apple Distribution，**不等于** Developer ID Application；外发前请在 Apple Developer 后台创建并导出后者。

## 必填 GitHub Secrets

在仓库 `Settings → Secrets and variables → Actions` 配置：

| Secret | 用途 |
|---|---|
| `JARVIS_SIGN_KEY` | ed25519 PKCS8 PEM 私钥全文（Linux 流水线已用；未配置则 `build:server` 硬失败） |
| `MAC_DEVELOPER_ID_P12_BASE64` | Developer ID Application 证书 `.p12` 的 base64 |
| `MAC_DEVELOPER_ID_P12_PASSWORD` | 上述 `.p12` 密码 |
| `MAC_CSC_IDENTITY_NAME` | 可选。例如 `Developer ID Application: Your Org (TEAMID)`；空则自动选取导入后的第一个 Developer ID Application |
| `APPLE_ID` | 公证用 Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | [appleid.apple.com](https://appleid.apple.com) 生成的 App 专用密码 |
| `APPLE_TEAM_ID` | Team ID（例如与 iOS 相同的 `4VPXQ6C88H`） |
| `KEYCHAIN_PASSWORD` | CI 临时钥匙串密码（任意随机串） |

### 导出 `.p12` 并写入 Secret（示例）

```bash
# 在钥匙串中导出「Developer ID Application」为 developer-id.p12 后：
base64 -i developer-id.p12 | pbcopy   # 粘贴为 MAC_DEVELOPER_ID_P12_BASE64
```

### 生成 / 轮换 seed 签名密钥（若仓库尚无）

```bash
node scripts/artifact-keygen.mjs --out .dev-keys/sign-key.pem
# 私钥内容 → Secret JARVIS_SIGN_KEY（切勿提交 git）
# stdout 的公钥 JSON → 并入客户端 pinned keyset（发布典礼）
```

## 远程 dry-run 前置条件

当前开发环境曾遇到：

1. **HTTPS** 访问 `github.com:443` 超时，无法用 `origin` HTTPS 推送  
2. **SSH** 可连通，但账号对 `mengtian999/bitjarvis` **无写权限**（曾以 `George070200` 认证）  
3. macOS 专用 Secrets（Developer ID / 公证）多半尚未配置  

因此「点一次 Actions 就出 DMG」需要：有写权限的账号推送本分支/提交到默认分支 → 配齐 Secrets → 再 `workflow_dispatch`。

本地已校验：`mac-release.yml` 可解析；`merge-latest-mac-yml.cjs` 双架构合并产物形状正确。

推送示例（有权限的账号）：

```bash
git push -u origin chore/mac-release-workflow
# 合并进 main 后：
gh workflow run "macOS Release" -R mengtian999/Bitjarvis -f tag=v0.0.4 -f skip_notarize=false
```

## 如何触发

**手动（推荐，与 iOS 一致）：**

1. 打开 GitHub Actions → **macOS Release** → **Run workflow**
2. 填写 `tag`（例如 `v0.0.4`，与已有 Linux 包挂同一 release）
3. `skip_notarize` 仅调试用；**正式上线必须为 false**

**打 tag 自动：**

```bash
git tag v0.0.x
git push origin v0.0.x
```

会同时触发 Linux Release 与 macOS Release（若两者都存在）。

### CLI 触发

```bash
gh workflow run "macOS Release" -R mengtian999/Bitjarvis -f tag=v0.0.4 -f skip_notarize=false
gh run watch -R mengtian999/Bitjarvis
```

## 流水线做什么

1. 导入 Developer ID → 设置 `CSC_*` 与 `JARVIS_MACHO_SIGN_IDENTITY`
2. 写入 `JARVIS_SIGN_KEY`；物化 `build/server-macho-entitlements.plist`（`build/` 在 gitignore 内）
3. 构建 renderer / IM web / sherpa / computer-use（arm64+x64）/ server seed（arm64+x64）
4. `electron-builder --mac dmg zip --arm64 --x64`（`afterSign` → 公证）
5. `merge-latest-mac-yml.cjs` 合并自动更新元数据
6. 上传到指定 tag 的 GitHub Release：`*-macOS-*.dmg` / `*.zip` / `latest-mac.yml`

## 本机正式打包（备选，非云路径）

要求：Node `>=24.12 <25`、Flutter、Xcode CLT、**Developer ID Application**、上述环境变量。

```bash
export JARVIS_SIGN_KEY=/path/to/sign-key.pem
export JARVIS_MACHO_SIGN_IDENTITY="Developer ID Application: … (TEAMID)"
export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=…
mkdir -p build && cp desktop/entitlements.mac.plist build/server-macho-entitlements.plist
npm ci
npm run dist   # 或按 workflow 分步双架构构建
```

仅本地自测、不可外发：`SKIP_NOTARIZE=true` + ad-hoc（`npm run install:local`）。

## 上线检查清单

- [ ] Developer ID Application 证书有效，已写入 `MAC_DEVELOPER_ID_*` Secrets
- [ ] 公证三件套 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` 已配置
- [ ] `JARVIS_SIGN_KEY` 与线上客户端 pinned keyset 匹配
- [ ] 云打包成功，Release 含 arm64 + x64 的 dmg/zip 与 `latest-mac.yml`
- [ ] 干净 Mac 上下载 DMG：Gatekeeper 无拦截，应用可启动
- [ ] 已安装旧版客户端能通过 `latest-mac.yml` 检测到更新（可选）

## 明确不做

- Mac App Store（需 MAS 证书、沙盒裁剪、不同 electron-builder target）
- 首版不包含完整 hot-update train 发布（`publish-train.mjs` / 完整 `build.yml` 可二期接入）
