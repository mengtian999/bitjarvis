# Bit Jarvis v0.0.4 更新说明 / Release Notes

## 修复 / Fixes

### 首次安装与冷启动不再出现"满屏英文键"的页面
**No more raw-key screen on first install / cold boot**

此前首次安装或冷启动较慢时，主窗口可能在语言包加载完成前被提前显示，整屏只剩 `sidebar.title`、`status.connecting` 这类原始翻译键，看起来像卡死。本版本：

- 语言包在界面首帧渲染前完成预加载（本地缓存 → 配置文件 → 系统语言，最多等待 1.2 秒，绝不阻塞启动）；
- 主窗口改为等待渲染器完全初始化后再显示（兜底预算 30s → 75s，与 server 就绪预算对齐）；
- 服务端语言偏好变化时按需对齐，不再重复拉取语言包。

Previously, on slow first installs or cold boots the main window could appear before the language pack loaded, leaving a full screen of raw i18n keys (`sidebar.title`, `status.connecting`, ...). The locale bundle is now preloaded before the first paint (local cache → agent config → system language, capped at 1.2s so it never blocks startup), and the main window is only shown once the renderer is fully initialized (fallback budget raised from 30s to 75s, aligned with the server readiness budget).

### 同版本重装后离线自修复能力不再丢失
**Offline self-repair no longer breaks after same-version reinstalls**

修正了一个 seed 归档清理的边界问题：当重装包与已激活内容版本号相同（字节不同）时，随包的离线恢复归档会在启动 90 秒后被误删。此后一旦需要离线重新激活（网络不可用、产物损坏），应用将无路可走并启动失败。现在清理器会校验"已激活产物与随包清单字节一致（sha256）"才允许清理，任何不确定情况一律保留归档。

Fixed a seed archive cleanup edge case: when a reinstall ships the same version number with different bytes, the packaged offline-recovery archives were mistakenly deleted 90 seconds after boot, leaving no path for offline re-activation. The cleanup now requires the activated artifacts to byte-match the packaged manifest (sha256) before deleting anything; any uncertainty keeps the archives.

### Windows 打包稳定性
**Windows packaging reliability**

修复打包器在 Windows 上因文件句柄耗尽（EMFILE）而随机失败的两处根因：Office PDF 字体资产断言与 node-file-trace 依赖裁剪扫描均移入拥有独立句柄表的子进程执行。

Fixed two root causes of random EMFILE (too many open files) failures in the Windows packager: the Office PDF font assertion and the node-file-trace prune scan now run in child processes with their own clean fd tables.

## 其他 / Internal

- 应用内"关于"页更新历史新增 0.0.4 条目。
- In-app About page update history gains a 0.0.4 entry.
