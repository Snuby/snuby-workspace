# Spec 012 — 设计

## 架构决策

### 决策 1：next 生产服务器以 ELECTRON_RUN_AS_NODE 子进程运行

- 主进程 `spawn(process.execPath, ["--no-warnings", nextCli, "start", "-H", "127.0.0.1", "-p", port])`，env 加 `ELECTRON_RUN_AS_NODE=1`（Electron 二进制以纯 Node 模式运行 next CLI，与 Web 版 `npm start` 完全同构）。
- 理由：
  - **行为可预期**：与 `next start` 同路径，已随 Web 版长期验证；不依赖内嵌 programmatic API 在打包环境的怪癖。
  - **崩溃隔离**：next 进程独立，主进程崩溃不会连带 next；quit 时 `child.kill()` 清理（AC-D 已验证无残留）。
  - **自包含**：Electron 自带 Node（主进程内嵌 Node 24），不依赖系统 node。
- 放弃内嵌 `next({dev:false})` 的原因（实测两条死路）：
  1. asar 开启 → next 内部 spawn 自身组件 → `spawn ENOTDIR`（asar 内路径不可作可执行文件）→ 必须 `asar: false`。
  2. 内嵌 prepare 读取 TS 版 `next.config.ts` 触发构建工具链（transpile-config → swc → `compiled/browserslist`），打包裁剪环境缺该链报 `Cannot find module`；传 `conf:{}` 可跳过 TS 解析，但打包态 `prepare()` 仍静默挂起（CPU 0%，无窗口无报错，根因未查明，不再深挖）。
- 端口策略：从 3310 起递增探测；`next start` 因端口占用（EADDRINUSE）非零退出则尝试下一个端口，最多 10 次。与 Web 版固定 3300 完全解耦（AC-D）。

### 决策 2：asar: false（全量真实文件）

- next 运行时内部会 spawn/require 自身组件（编译链、worker），asar 内路径不可执行/解析 → 实测必须关闭 asar。
- 代价：app 包内大量小文件（目录体积与 asar 相当），macOS 上可接受；electron-builder 会提示 strongly not recommended，属已知取舍。
- `.next/**` 因此不再需要 asarUnpack（真实文件）。

### 决策 3：零业务代码改动，环境契约补齐

现有代码已支持桌面化，主进程只补三件事（见下）：
- 仓储：`MACRO_DB_PATH` / `MARKET_DB_PATH`（env ?? cwd 默认，spec 001/009）。
- fetch：`PROJECT_ROOT = process.cwd()` + 相对 `scripts/*.py`（spec 003）；python 脚本读 env 覆盖输出库路径。
- 因此**不修改 `src/**`**（AC-B 一致性 + AC-E 回归零风险）。

### 决策 4：数据模板内置 + userData 可写区

```
打包时 (extraResources):
  Resources/data/     ← data/china_economy.db, market.db (模板)
  Resources/scripts/  ← scripts/*.py (fetch 用)
运行时 (主进程启动时):
  userData/data/ ← 首次启动从模板复制 (幂等, 已存在则跳过)
  env:
    MACRO_DB_PATH    = userData/data/china_economy.db
    MARKET_DB_PATH   = userData/data/market.db
    FETCH_PYTHON_BIN = 检测到本机 venv 则设置 (不存在不设, 走现有降级)
  process.chdir(Resources/)  → fetch 的 PROJECT_ROOT 命中 scripts/
```
- asar 只读、userData 可写 → 读取与「更新数据」写入互不干扰（AC-C）。
- 开发模式（`electron .` 未打包）不复制模板：直接以项目根 `data/` 为库路径（chdir 项目根）。

### 决策 5：打包配置（electron-builder）

- `appId: com.snuby.workbench`；`productName: "Snuby 工作台"`；mac target: dmg + zip；`identity: null`（无证书，跳过签名）。
- `files` 白名单：`electron/**`、`.next/**`（排除 cache）、`package.json`；node_modules 生产依赖由 builder 自动纳入。
- `asar: false`（决策 2）；`extraResources`: data/、scripts/。
- 图标：`build/icon.icns`（SVG 手绘 → qlmanage 转 PNG → sips 缩放出 iconset → iconutil 合成）。

### 决策 6：单实例

- `app.requestSingleInstanceLock()`：重复启动时聚焦已有窗口（`second-instance` → restore + focus），不重复拉起 next 进程。

## 数据流

```
用户双击 Snuby 工作台.app
  → 主进程: 单实例锁 → 初始化 userData/data (模板复制 + env + chdir Resources/)
  → spawn next start (ELECTRON_RUN_AS_NODE) → 探测 3310+ 可用端口
  → BrowserWindow(1440x960, title=Snuby 工作台) → loadURL http://127.0.0.1:port/
  → 页面/API 全部由 next 子进程处理 (含 OR 榜单外网 API、AA iframe)
  → 退出: will-quit → child.kill() → 无残留进程、端口释放 (AC-D 已验证)
```

## 接口契约

- `electron/main.js` 无导出接口；通过环境变量与工作目录与既有 `src/**` 契约对接：
  - `MACRO_DB_PATH` / `MARKET_DB_PATH` / `FETCH_PYTHON_BIN`（与 Web 版同一组变量名）。
- `package.json`：
  - `"main": "electron/main.js"`（electron 入口；next 构建不受影响）。
  - scripts：`desktop` = `npm run build && electron .`；`dist` = `npm run build && electron-builder --mac`。

## 验证路径

1. `npm run build` → `npx electron .`（开发壳，加载项目根构建产物 + 项目 data/）。
2. 浏览器（bu）目检窗口：首页、`/macro`、`/market`、`/ai-leaderboard`、`/ai-leaderboard/openrouter`。
3. `npm run dist` → 启动 `dist/mac-arm64/Snuby 工作台.app` → 复检上述页面 + userData 数据文件存在 + 3300 端口未被占用（桌面端用 3310+）。
4. 退出 app → 确认主进程与 next 子进程均退出、端口释放（AC-D）。

### 决策 1 修订（2026-09-23）：ELECTRON_RUN_AS_NODE → utilityProcess.fork

原方案实测暴露缺陷：`ELECTRON_RUN_AS_NODE=1` spawn 的进程「有可执行文件身份、无 GUI 身份」，macOS 在 Dock 上显示为通用 exec 图标，用户可随手点关（杀掉后窗口白屏——外壳与内核是两个进程，但内核不应暴露为可关对象）。

修订：改用 Electron 官方 `utilityProcess.fork(nextCli, ["start", "-H", "127.0.0.1", "-p", port], { cwd: app.getAppPath(), env: {...process.env}, stdio: "pipe" })`：
- 纯后台 Node 进程（Helper Utility 形态），不上 Dock、无独立图标；
- 生命周期挂靠主进程：app 退出自动终止，不留孤儿进程占端口（will-quit 内 `child.kill()` 双保险）；
- 无需 ELECTRON_RUN_AS_NODE；Ready 日志 / 端口可达性轮询 / 3310+ 探测逻辑不变。

验证：开发壳与打包版 3310 服务正常，进程形态为 `Electron Helper (Utility)` / `next-server`，退出零残留。
