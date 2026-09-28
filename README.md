# Snuby 工作台

本地 **桌面 APP**（Electron + Next.js）。采用 SDD（规格驱动开发），规格见 [`docs/`](docs/README.md)。

> 产品形态仅为 APP；不再维护独立浏览器 Web 版。

## 快速开始

```bash
npm install
npm run desktop   # = npm run build && electron .  （日常开发/使用）
npm test          # 测试套件
```

打包发布：

```bash
npm run dist      # 构建 + 打包 macOS .app / dmg（产物在 dist/，不提交 git）
```

应用内端口自 **3310** 起递增探测。

## 软件数据 vs 用户数据

| 类别 | 位置 | 内容 |
|------|------|------|
| **软件** | 本仓库 / 安装包 Resources | 代码、构建产物 |
| **用户数据** | **`~/snuby-workspace-data/`** | 使用过程产生的全部业务数据 |

```
~/snuby-workspace-data/
├── site_tabs.db          # 主题 / 站点 / 标签
└── agent-sessions/       # Agent 会话 (meta / messages / artifacts)
```

- 可用环境变量 `SNUBY_USER_DATA` 覆盖根目录；亦可分别覆盖 `SITE_TABS_DB_PATH` / `AGENT_SESSIONS_PATH`。
- **首次启动**会从旧路径幂等迁入（项目 `data/`、`~/Library/Application Support/snuby-*/data`），已存在的文件不覆盖。
- Electron 的 `Application Support/snuby-dev`（或打包名）仅保留 Chromium/窗口等运行时缓存，**不再**存放业务库。

## 目录结构（软件仓库）

```
snuby-workspace/
├── docs/                  # SDD 文档
├── electron/              # 桌面主进程
├── data/                  # 仅可选遗留；运行时读写走 ~/snuby-workspace-data
└── src/                   # Next.js 业务代码（domain / infrastructure / app）
```

## 功能模块（摘要）

- **工作台** `/` — 模块入口
- **主题 / Web 访问** — 可配置站点集合与内嵌浏览（桌面 webview）
- **本地 Agent** — 对接本机 WorkBuddy ACP（多会话隔离，见 spec 017）
- **设置** `/settings`

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `SNUBY_USER_DATA` | `~/snuby-workspace-data` | 用户数据根 |
| `SITE_TABS_DB_PATH` | `$SNUBY_USER_DATA/site_tabs.db` | 主题/站点库 |
| `AGENT_SESSIONS_PATH` | `$SNUBY_USER_DATA/agent-sessions` | Agent 会话 (含 artifacts) |
