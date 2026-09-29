# Spec 012 — Electron 桌面打包（Snuby 工作台）

状态：done

## 目标

将现有 Next.js 工作台（spec 001–011）打包为 macOS 桌面应用 **「Snuby 工作台」**（.app + dmg），应用内自包含 Next.js 生产服务器，开箱即用，无需手动启动 `npm start`。

## 核心决策（详见 design.md）

1. **next 生产服务器以 `ELECTRON_RUN_AS_NODE` 子进程运行**（`spawn(process.execPath, [...next, "start", "-H", "127.0.0.1", "-p", port])`）：与 Web 版 `npm start` 同构、行为可预期、崩溃隔离；主进程退出时 `child.kill()` 清理（AC-D 实测无残留）。放弃内嵌 programmatic API —— asar 下 `spawn ENOTDIR`、TS 配置触发构建链缺失、打包态 `prepare()` 静默挂起（均为实测死路）。
2. **asar: false 全量真实文件**：next 运行时内部 spawn/require 自身组件，asar 内路径不可用（实测必须关闭）。
3. **零业务代码改动（历史）**：桌面端通过环境变量与工作目录对接仓储；宏观/行情库与 fetch 脚本已于 2026-09-27 下线，现仅注入 `SITE_TABS_DB_PATH` / `AGENT_*` / `SNUBY_USER_DATA`。
4. **数据隔离**：打包内置 `data/*.db` 模板，首次启动复制到 `userData/data/`（幂等），读写均在该目录。
5. **端口**：3310 起递增探测（EADDRINUSE 自动换端口），避免与 Web 版（3300）冲突。
6. **单实例锁**：重复启动聚焦已有窗口，不重复拉起 next 进程。

## 非目标

- 不做 Windows/Linux 包（仅本机 macOS；配置留出扩展位）。
- 不做自动更新（autoUpdater）、签名/公证（无开发者证书，`identity: null`）。
- 不迁移 Python 数据管道进应用（fetch 仍依赖本机 venv + akshare，按钮降级逻辑沿用 spec 003/009）。
- 不改动 spec 001–011 任何页面/API/数据契约。

## 交付物

- `electron/main.js` — 主进程：单实例锁 → 数据初始化 → next server（ELECTRON_RUN_AS_NODE）→ BrowserWindow → 退出清理
- `electron-builder.yml` — 打包配置（appId/productName/files/asar:false/extraResources/mac）
- `package.json` — `main` 字段 + `desktop` / `dist` scripts + electron/electron-builder devDependencies
- `build/icon.svg` / `icon.icns` / `icon.png` — 应用图标
- `docs/specs/012-electron-packaging/` 四件套
- 产物：`dist/Snuby 工作台-0.1.0-arm64.dmg` + `dist/mac-arm64/Snuby 工作台.app`（不提交 git）

## 变更记录

- 2026-09-23: 初版（implementing）；内嵌 next + asarUnpack。
- 2026-09-23: 实测死路 → 改 `ELECTRON_RUN_AS_NODE` 子进程 + `asar: false` + 3310+ 探测端口 + 单实例锁；打包产物验证通过（首页/macro/OR/AA 全 200、userData 数据初始化、退出无残留），状态转 done。
