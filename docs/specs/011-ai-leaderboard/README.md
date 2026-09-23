# 011 — ai-leaderboard（AI 模型榜单）

状态: **implementing**（2026-09-23 规格初版，用户直接指令，实现与评审并行）

## 目标

工作台新增第四个一级板块「AI 模型榜单」，把两个权威外部榜单**以 iframe 嵌入右侧内容区**，跟随官方页面实时更新，零本地数据：

1. **Artificial Analysis**（`https://artificialanalysis.ai/`）— 独立第三方系统化评测（智能指数/速度/价格）
2. **OpenRouter Rankings**（`https://openrouter.ai/rankings`）— 按真实 token 用量排名的生态榜

## 为什么用 iframe 而不是抓数据

- 两个榜单页面更新频繁（AA 模型发布即更、OR 实时），iframe 天然跟随官方最新状态，免维护；
- 不复制榜单数据到本地（与 spec 010 的融资事件"结构化沉淀"诉求相反，此需求是"看最新"而非"存下来分析"）；
- 用户在 AI 资讯调研中已确认这两个源权威且及时。

## 数据源可行性（2026-09-23 本机实测）

| 源 | 响应头 | 可直嵌 |
|---|---|---|
| artificialanalysis.ai | 无 `X-Frame-Options`、无 CSP `frame-ancestors` 限制 | ✅ 直接 iframe |
| openrouter.ai/rankings | `x-frame-options: SAMEORIGIN` + CSP `frame-ancestors 'self'` | ❌ 需同源代理 |

## 设计决策

1. **路由组 `(leaderboard)/` + 两个子页**：`/ai-leaderboard`（AA 默认）、`/ai-leaderboard/openrouter`（OR），共用 Topbar + SectionTabs 二级菜单（与 spec 008/009 同构）。
2. **AA 子页**：`LeaderboardFrame`（client，固定 src、`h-full w-full` 填满滚动容器），直接 iframe `https://artificialanalysis.ai/`（实测无嵌入限制），页面上方附"在新窗口打开"外链。
3. **OR 子页（用户决策后修订）**：官方页面 `x-frame-options: SAMEORIGIN` + CSP `frame-ancestors 'self'` 拒绝嵌入；同源代理（route handler 剥离限制头 + 路径重写）虽可显示页面框架，但页面动态数据层依赖 clerk 认证组件，在 iframe 下（第三方 cookie 受限）挂起、**不发任何数据请求**（浏览器实测 0 个 API 请求，非延迟问题）。**结论：OR 改为服务端直连其公开 API** `https://openrouter.ai/api/frontend/v1/rankings/models?view=week`（无鉴权，实测 200），在 `src/domain/or-rankings.ts` 聚合（按模型求和 token、排序、`shortModelName`/`formatTokens` 纯函数），由 `OpenRouterBoard` 自渲染 Top 15 横向柱状图 + Top 50 表格，配官方直链。
4. **失败隔离**：OR 服务端 fetch 失败/空数据 → 页面显示错误提示 + 官方直链；AA iframe 加载失败由官方页面自行呈现。

## 非目标

- **不抓取/不存储榜单数据**：服务端每次实时 fetch，不落库、不做历史分析。
- **不绕过 OR 登录**：不代理其认证体系；榜单 API 为公开数据。
- **不修改既有板块**（spec 001–009）任何契约。

## 依赖与复用

| 复用对象 | 来源 | 用途 |
|---|---|---|
| 路由组 + 共享 layout 层级模式 | spec 008 / 009 | `(leaderboard)/` 外壳 |
| `SectionTabs` 参数化二级菜单 | spec 008 / 009 | 两个源切换 |
| `Topbar` | spec 001 | 板块标题 |

## 交付物

- `src/app/(leaderboard)/layout.tsx` + `ai-leaderboard/page.tsx` + `ai-leaderboard/openrouter/page.tsx`
- `src/components/leaderboard/leaderboard-frame.tsx`（AA iframe 组件）
- `src/components/leaderboard/openrouter-board.tsx`（OR 自渲染面板：图表 + 表格）
- `src/domain/or-rankings.ts` + `or-rankings.test.ts`（聚合/格式化纯函数与单测）
- `src/components/workbench/sidebar.tsx` 增一级菜单「AI 模型榜单」
- `src/app/page.tsx` 首页模块卡片
- （已废弃）`/or-proxy/[...path]` 同源代理与 `next.config` rewrites —— 实测动态数据层无法激活，已删除

## 已确认决策

| 议题 | 方案 |
|---|---|
| 板块名称与路由 | 「AI 模型榜单」`/ai-leaderboard` |
| 两个源的组织 | 二级菜单切换（AA 默认页 + OR 子页） |
| Artificial Analysis | 直接 iframe（实测无嵌入限制） |
| OpenRouter | 官方页面拒绝嵌入且代理无法激活动态数据 → **官方公开 API 自渲染**（用户批复） |
| 数据策略 | 零本地数据；AA iframe 跟随，OR 服务端实时 fetch |

## 变更记录

- 2026-09-23: 初版（implementing）。数据源可行性基于本机 curl 实测。
- 2026-09-23: **方案修订**。实测：同源代理可显示 OR 页面框架，但动态数据层（clerk 认证在 iframe 下挂起）不发任何 API 请求，图表/榜单空白；经用户批复，OR 改为官方公开 API 服务端聚合自渲染，删除 `/or-proxy` 代理与 rewrites。AA iframe 不受影响。
