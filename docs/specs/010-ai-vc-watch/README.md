# 010 — ai-vc-watch（AI 创投观察）

状态: **draft**（2026-09-22 规格初版，待用户评审）

## 目标

新增工作台第三个一级板块「AI 创投观察」，把 AI 领域**融资事件**沉淀为结构化数据：

1. **数据积累（核心）**：英文源（TechCrunch Venture RSS + Hacker News Algolia）自动化抓取，存量回填 + 增量更新；中文源（IT桔子 / 烯牛 / 公众号）因反爬实测不可程序化抓取，提供**人工录入**通道补足 —— 数据慢慢积累，为后续可视化分析打地基。
2. **事件流**：按时间倒序的融资事件列表（公司 / 轮次 / 金额 / 赛道 / 来源 / 链接），支持过滤与分页。
3. **可视化分析**：赛道分布 + 月度融资趋势（ECharts），口径可追溯。

## 为什么做这个板块

用户在上一轮「AI 信息获取渠道」调研中确认：AI 热门投资是**结构化数据**（公司 + 轮次 + 金额 + 赛道 + 时间），正是工作台（Python 管道 → SQLite → API → 可视化）擅长的形态；而资讯阅读（RSS/邮件/公众号）属于内容流，留在阅读器即可，不进工作台。

## 数据源（2026-09-22 本机实测）

| 源 | 形态 | 实测 | 用途 |
|---|---|---|---|
| TechCrunch Venture RSS | RSS 2.0 | ✅ 可用（小时级） | 英文主源 |
| HN Algolia API | JSON | ✅ 可用（支持历史回填） | 英文补充 |
| IT桔子 / 烯牛 / Dealroom / 36氪 / MapCo | 网页/API | ❌ 反爬或需登录（详见 design 第一节） | 人工录入 / 排除 |

## 非目标

- **不做资讯聚合**：不抓 RSS 文章正文、不展示内容流；板块只沉淀**融资事件**这种结构化记录。
- **不绕过反爬**：IT桔子瑞数防护、烯牛登录墙均不硬啃（违背轻量管道原则）；中文数据用人工录入补足。
- **不做实时监控**：无定时任务，抓取由页面按钮手动触发（沿用 spec 003 交互模型）。
- **不做公司/人物图谱**：本期只做事件流 + 聚合分析，公司实体关系留待后续 spec。
- **不改动** `china_economy.db` / `market.db` 与既有板块（spec 001–009）的任何行为与契约。

## 依赖与复用

| 复用对象 | 来源 | 用途 |
|---|---|---|
| 子进程进度协议（`@@PROGRESS` / `@@DONE`） | spec 003 | 抓取进度可见 |
| 内存单例任务状态 + 409 防重复 | spec 003 | 抓取期间禁止重复触发 |
| 路由组 + 共享 layout 层级模式 | spec 008 / 009 | `(vc)/` 与既有板块同构 |
| `SectionTabs` 二级菜单（已参数化） | spec 008 / 009 | 直接复用 |
| 幂等 upsert + 失败隔离 + 退避重试 | spec 009 | 管道骨架 |
| 测试分层（domain 单测 / application 集成） | spec 006 / 007 | 解析与聚合纯函数优先覆盖 |
| ECharts 惰性初始化 / 双轴约束 | spec 009 | 图表组件防坑 |

## 交付物（规划）

**数据层**
- `scripts/fetch_vc.py` — 融资事件抓取管道（新增）
- `data/vc.db` — 独立 SQLite 库（运行时生成，gitignore）

**领域层**
- `src/domain/vc.ts` — `DealEvent` 类型、`SECTOR_TAGS` 常量、`parseAmount()` / `normalizeRound()` / `classifySector()` / `toUsd()` / `formatUsd()` 纯函数
- `src/domain/vc.test.ts` — 单测

**用例层**
- `src/application/vc-service.ts` — `getDealFeed()` / `getVcStats()` / `createManualDeal()`
- `src/application/vc-service.test.ts` — 集成测试

**基础设施**
- `src/infrastructure/sqlite-vc-repository.ts` — 只读 + 写入仓储
- `src/infrastructure/vc-fetch-runner.ts` — 子进程 runner（复用 `fetch-runner.ts` 泛化模式）

**表现层**
- `src/app/(vc)/layout.tsx` + 2 个子页（`/ai-vc` 事件流、`/ai-vc/analytics` 分析）
- `src/components/vc/` 下 6 个组件
- `src/app/api/vc/` 下 5 条路由

## 已确认决策（待用户评审）

| 议题 | 建议方案 | 状态 |
|---|---|---|
| 板块名称与路由 | 「AI 创投观察」`/ai-vc` | 待确认 |
| 二级菜单划分 | 事件流 + 分析 两页 | 待确认 |
| 中文数据获取 | 本期人工录入，烯牛 MCP 后置 | 待确认 |
| 金额展示 | 原币为主 + USD 近似换算（仅聚合） | 待确认 |

## 变更记录

- 2026-09-22: 初版（draft）。数据源结论基于本机实测；规格四件套齐备（README / requirements / design / tasks）。
