# Snuby 编码与架构规范

本文档为全局规范，所有 spec 的设计与实现必须遵守。术语与代码命名保持一一对应。

## 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | Next.js 15 (App Router) + React 19 | 本地 Web 应用 |
| 语言 | TypeScript (strict) | 全部业务代码 |
| 样式 | Tailwind CSS v4 | 不写自定义 CSS 文件（globals.css 仅放 token） |
| 图表 | ECharts 5 | 按需引入 `echarts/core` + 用到的图表/组件 |
| 数据 | SQLite | 物理文件 `data/china_economy.db`，Python 管道写入，Node `node:sqlite` 只读 |
| 数据管道 | Python + akshare (`scripts/fetch_data.py`) | 定时任务每周一 09:00 执行 |

## 分层架构（整洁架构）

依赖方向只能从外层指向内层，禁止反向依赖：

```
app/(路由+API)  →  application(用例)  →  domain(实体+类型)  ←  infrastructure(仓储)
```

| 层 | 目录 | 职责 | 禁止 |
|----|------|------|------|
| domain | `src/domain/` | 实体、类型、纯函数、业务规则 | 不 import 任何框架/IO 库 |
| application | `src/application/` | 用例编排（读仓储 → 组装视图模型） | 不直接碰 SQL / HTTP |
| infrastructure | `src/infrastructure/` | SQLite 读写、外部数据适配 | 不含业务规则 |
| presentation | `src/components/`、`src/app/` | UI 渲染与交互 | 不写 SQL / 业务规则 |
| scripts | `scripts/` | Python 数据管道（TS 项目之外） | — |

## 术语表（文档与代码一致）

| 术语 | 代码 | 含义 |
|------|------|------|
| 指标 | `Indicator` | 一个可观测的宏观经济序列 |
| 数据点 | `SeriesPoint` | `{ date, value }`，date 为 `YYYY-MM` / `YYYY-MM-DD` |
| 指标分组 | `IndicatorGroup` | 侧边栏/页面中的维度分组（总量增长、货币金融等） |
| 数据观察 | Data Observation | 工作台一级菜单，聚合各类数据模块 |
| 国家经济数据 | Macro Data | `数据观察` 下的模块，展示中国宏观经济指标 |
| 抓取任务 | `FetchJobState` | 一次数据抓取的运行态（idle/running/done/error），存 Node 进程内存（spec 003） |
| 更新数据 | Fetch Button | `/macro` 页手动触发抓取的按钮，运行中禁用防重复 |
| 告警规则 | `AlertRule` | 对指标的阈值/异动判定配置（threshold / delta_drop / compare 三类，spec 002） |
| 告警项 | `AlertItem` | 一条规则对最新数据的评估结果（triggered / normal / no_data） |

## 代码风格

1. TypeScript `strict` 开启；禁止 `any`，必要时用 `unknown` + 类型守卫。
2. 命名：文件用 kebab-case；类型/组件用 PascalCase；函数/变量用 camelCase；常量用 UPPER_SNAKE_CASE。
3. 服务端代码（仓储、用例）只在 Server Component / Route Handler 中调用，不进入 `"use client"` 文件。
4. 客户端组件必须显式 `"use client"`；图表组件接收纯数据 props，内部不做数据加工。
5. 错误处理：仓储层抛出带上下文的 `Error`；页面级错误由 `error.tsx` 兜底，不让白屏。
6. 注释只解释「为什么」，不解释「是什么」；涉及规格的地方标注 spec 编号。
7. 环境变量：数据库路径用 `MACRO_DB_PATH`（默认 `data/china_economy.db`），不硬编码绝对路径。

## 运行模式约定

| 模式 | 命令 | 响应时间 | 用途 |
|------|------|----------|------|
| 生产 | `npm run build && npm start` | ~0.2s | **日常使用（默认）** |
| 开发 | `npm run dev` | ~2s | 改代码时 |

- dev 模式（Turbopack）每次导航现场编译，页面响应慢是固有开销，非性能问题。
- 生产模式改代码后必须重新 build；数据更新（`npm run fetch`）无需重新 build，页面为 `force-dynamic` 实时读库。
- 端口统一 **3300**（`start` 脚本已内置）。

## 测试约定（spec 006）

| 项 | 约定 |
|---|---|
| 运行 | `npm test`（Node 内置 `node:test`，`tsx` 作 TS 加载器） |
| 位置 | 与被测模块同目录，命名 `*.test.ts` |
| 范围 | 契约类纯逻辑（domain 层）必测；infra/application 的集成测试按需另立 spec |
| 原则 | 断言固化 spec 契约（边界、排序、容忍度、key 完备性），不测实现细节 |

## Git 约定

- 分支：`feat/<spec编号>-<slug>`，如 `feat/001-macro-dashboard`。
- 提交信息：`<type>(<scope>): <subject>`，type ∈ feat/fix/docs/refactor/chore。

## 数据口径备忘

- **数据源选择原则**（spec 004）: 优先用国家统计局官方接口，不用东财「报告式」接口（`*_yearly`，属网页快讯口径，源本身滞后约一年）。已替换: 工业增加值 `macro_china_gyzjz`、CPI `macro_china_cpi`、PPI `macro_china_ppi`、PMI `macro_china_pmi`、外储 `macro_china_fx_gold`。
- 官方月度源返回**降序**（最新在前），提取器一律 `sorted(key=date)` 归一升序。
- **时效性判定**: `isStale(latestDate, freq)` 按频率容忍滞后月数 —— 月度 3、季度 6、半年度 8（`STALE_LAG_MONTHS`）。超限的指标在界面标注「数据源滞后 N 个月」，不隐藏。
- 确认滞后且无免费替代源的 3 项: 社融增量 `shrzgm`（商务数据中心口径）、企业景气指数 `boom_index`（季度）、国房景气指数 `real_estate_index`。引用这些指标做判断时须注意时效。
- `macro_china_gdp` 官方源只有 Q1 单季 + 累计期，累计期统一映射到季度末月份（03/06/09/12）。
- 70 城房价同比 = 各城市「新建商品住宅价格指数-同比」减 100 后的均值。
- 贸易差额 = (当月出口额 − 当月进口额) / 1e5，单位亿美元（源单位千美元）。
- **行业指标口径**（spec 005）: 日频源（大宗商品/农产品/建材指数）按**每月最后一个观测值**月末采样，使 36 期窗口统一为 36 个月；`YYYY.M` 格式（用电量/货运量/客座率）统一归一为 `YYYY-MM`。
- 指标口径说明文案统一维护在 `src/domain/macro.ts` 的 `INDICATOR_DESCRIPTIONS`（键 = 指标 key）。
