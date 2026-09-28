# Snuby 编码与架构规范

本文档为全局规范，所有 spec 的设计与实现必须遵守。术语与代码命名保持一一对应。

## 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | Electron + Next.js 15 (App Router) + React 19 | **仅桌面 APP**（不维护独立浏览器 Web 版） |
| 语言 | TypeScript (strict) | 全部业务代码 |
| 样式 | Tailwind CSS v4 | 不写自定义 CSS 文件（globals.css 仅放 token） |
| 用户数据 | `~/snuby-workspace-data/` | 与软件目录分离；主题库 + Agent 会话（`SNUBY_USER_DATA` 可覆盖） |

## 分层架构（整洁架构）

依赖方向只能从外层指向内层，禁止反向依赖：

```
app/(路由+API)  →  application(用例)  →  domain(实体+类型)  ←  infrastructure(仓储)
```

| 层 | 目录 | 职责 | 禁止 |
|----|------|------|------|
| domain | `src/domain/` | 实体、类型、纯函数、业务规则 | 不 import 任何框架/IO 库 |
| application | `src/application/` | 用例编排（读仓储 → 组装视图模型）；无用例时可暂空 | 不直接碰 SQL / HTTP |
| infrastructure | `src/infrastructure/` | SQLite 读写、ACP 网关适配 | 不含业务规则 |
| presentation | `src/components/`、`src/app/` | UI 渲染与交互 | 不写 SQL / 业务规则 |

## 术语表（文档与代码一致）

| 术语 | 代码 | 含义 |
|------|------|------|
| 主题 | `Topic` | 可配置的站点集合（IT 资讯 / 自媒体 / AI 榜单等） |
| 站点标签 | site tabs | 某主题下多标签浏览状态，持久化于 `site_tabs.db` |
| AI 模型榜单 | AI Leaderboard | 主题入口，内嵌 Artificial Analysis / OpenRouter 等 |
| 本地 Agent | Local Agent | 对接本机 WorkBuddy ACP 的多会话工作台（spec 017） |
| Agent 会话 | `AgentSession` | 隔离的会话目录：meta + messages + 工作约定 |

## 信息架构

```
侧边栏（一级菜单）
├── 工作台        /             首页：模块卡片
├── （主题区）                 用户动态主题 → /topic/[id]
├── Web 访问      /browser      简易浏览器
├── 设置          /settings
└── （实验室）    /lab/local-agent  本地 Agent
```

- 主题宿主由 `TopicHost` + `/api/topics` 驱动，不在侧边栏硬编码宏观/行情类板块。
- 一级菜单激活判定：`NavLeaf.match` 列出该菜单对应的全部路径，任一命中即高亮。

## 代码风格

1. TypeScript `strict` 开启；禁止 `any`，必要时用 `unknown` + 类型守卫。
2. 命名：文件用 kebab-case；类型/组件用 PascalCase；函数/变量用 camelCase；常量用 UPPER_SNAKE_CASE。
3. 服务端代码（仓储、用例）只在 Server Component / Route Handler 中调用，不进入 `"use client"` 文件。
4. 客户端组件必须显式 `"use client"`。
5. 错误处理：仓储层抛出带上下文的 `Error`；页面级错误由 `error.tsx` 兜底，不让白屏。
6. 注释只解释「为什么」，不解释「是什么」；涉及规格的地方标注 spec 编号。
7. 环境变量：业务路径默认落在 `~/snuby-workspace-data/`（见 README）；`SITE_TABS_DB_PATH` / `AGENT_*` / `SNUBY_USER_DATA` 可覆盖，不硬编码用户家目录以外的绝对路径。

## 运行模式约定

| 模式 | 命令 | 用途 |
|------|------|------|
| 桌面 APP | `npm run desktop`（= `build` + `electron .`） | **日常使用 / 开发验证** |
| 打包 | `npm run dist` | 发布 .app / dmg |

- 改代码后需重新 `npm run build`（或 `desktop`）再开 APP。
- APP 内 Next 端口自 **3310** 起探测；用户数据始终在 `~/snuby-workspace-data/`（与仓库 `data/` 可选遗留分离）。

## 测试约定

| 项 | 约定 |
|---|---|
| 运行 | `npm test`（Node 内置 `node:test`，`tsx` 作 TS 加载器） |
| 位置 | 与被测模块同目录，命名 `*.test.ts` |
| 分层 | domain 纯函数与 infrastructure 仓储；presentation 暂不覆盖 |
| 数据隔离 | 集成测试写 `os.tmpdir()` 临时库，通过 `SITE_TABS_DB_PATH` 等注入，绝不触碰 `~/snuby-workspace-data` |
| 原则 | 断言固化契约（边界、排序、key 完备性），不测实现细节 |

## Git 约定

- 分支：`feat/<spec编号>-<slug>`，如 `feat/017-agent-session`。
- 提交信息：`<type>(<scope>): <subject>`，type ∈ feat/fix/docs/refactor/chore。
