# Spec 012 — 需求

## 用户故事

- US-1：作为用户，我希望双击桌面图标即可打开「Snuby 工作台」，无需手动启动 Node/Next 服务。
- US-2：作为用户，我希望桌面应用里现有全部板块（宏观经济 / 资产行情 / AI 模型榜单）功能与 Web 版一致。
- US-3：作为用户，我希望应用内置已有数据，首次启动即可看到内容（无需先跑数据管道）。
- US-4：作为用户，我希望在应用内仍可手动触发数据更新（沿用 spec 003 按钮），失败时有降级提示。

## 验收标准

### AC-A 构建与启动
- `npm run dist` 能产出 `dist/Snuby 工作台-0.1.0-arm64.dmg` 与 `dist/mac-arm64/Snuby 工作台.app`（本机构建为 macOS arm64）。
- 启动 .app 后出现窗口，标题为「Snuby 工作台」，无命令行窗口/无终端依赖。

### AC-B 功能一致性
- 窗口内首页渲染正常（四大板块卡片）；`/macro`、`/market`、`/ai-leaderboard` 与 `/ai-leaderboard/openrouter` 均可正常访问（浏览器目检）。
- OR 榜单页经官方公开 API 自渲染出 Top 15 图 + Top 50 表（说明网络访问正常）。

### AC-C 数据隔离
- 首次启动后 `~/Library/Application Support/snuby-workspace/data/` 下存在 `china_economy.db` 与 `market.db`（userData 目录由 package.json name 决定，实际为 `snuby-workspace`），与打包内置模板一致；再次启动不重复复制（幂等）。
- 应用内数据读取/更新使用 userData 目录，不写包内文件。

### AC-D 端口与稳定性
- 桌面应用使用 3310 起递增探测端口，不占用固定 3300 端口（Web 版可并行运行互不干扰）。
- 退出应用（Cmd+Q / 关窗）后主进程与 next 子进程完整退出，端口释放，无残留进程。

### AC-E 回归
- `npm test` 106 例全绿；`npm run build` 通过；Web 版 `PORT=3300 npm start` 行为不受影响（package.json 原有 scripts 未变）。
