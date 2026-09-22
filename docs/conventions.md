# Snuby 编码与架构规范

本文档为全局规范，所有 spec 的设计与实现必须遵守。术语与代码命名保持一一对应。

## 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | Next.js 15 (App Router) + React 19 | 本地 Web 应用 |
| 语言 | TypeScript (strict) | 全部业务代码 |
| 样式 | Tailwind CSS v4 | 不写自定义 CSS 文件（globals.css 仅放 token） |
| 图表 | ECharts 5 | **完整包导入** `import * as echarts from "echarts"`（spec 009 实测：Turbopack 下 `echarts/core` 按需导入报 `Renderer 'undefined'`，勿改回按需） |
| 数据 | SQLite | 宏观 `data/china_economy.db`、行情 `data/market.db`，Python 管道写入，Node `node:sqlite` 只读 |
| 数据管道 | Python + akshare (`scripts/fetch_data.py`) | **手动触发**（「宏观经济」头部按钮 / `npm run fetch`），无定时任务 |

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
| 指标分组 | `IndicatorGroup` | 页面中的维度分组（总量增长、货币金融、行业景气与高频等） |
| 宏观经济 | Macro Economy | **工作台一级菜单**，聚合下面三个子模块（spec 008） |
| 二级菜单 | `SectionTabs` | 「宏观经济」下切换子模块的顶部导航条（`src/components/workbench/section-tabs.tsx`） |
| 国家经济数据 | Macro Data | 「宏观经济」二级菜单项，`/macro`，8 个宏观分组共 26 项指标 |
| 行业观察 | Industry Watch | 「宏观经济」二级菜单项，`/industry`，`industry` 分组 10 项指标 |
| 跟踪提醒 | Alerts | 「宏观经济」二级菜单项，`/alerts`，规则评估结果（spec 002） |
| 抓取任务 | `FetchJobState` | 一次数据抓取的运行态（idle/running/done/error），存 Node 进程内存（spec 003） |
| 更新数据 | Fetch Button | 「宏观经济」头部手动触发抓取的按钮，运行中禁用防重复（spec 003/008） |
| 告警规则 | `AlertRule` | 对指标的阈值/异动判定配置（threshold / delta_drop / compare 三类，spec 002） |
| 告警项 | `AlertItem` | 一条规则对最新数据的评估结果（triggered / normal / no_data） |
| 资产 | `AssetMeta` | 一条可观测的行情序列（11 项：贵金属/加密货币/股指/房价，spec 009） |
| K 线 | `Candle` | `{ date, open, high, low, close, volume }`，无 OHLC 的资产 open/high/low 为 `null` |
| 粒度 | `Period` | K 线聚合粒度（日/周/月/年）；**窗口 `Range`（近1年~全部）是与之正交的另一维度** |
| 归一化 | `normalize` | 以基准日收盘价折算为 100 的指数化（保留涨跌幅语义，非 min-max），基准点 `NORMALIZE_BASE = 100` |
| 资产行情 | Market Quotes | **工作台一级菜单**，五个子页共用同一外壳（spec 009） |
| 行情二级菜单 | `MARKET_SECTIONS` | 综合对比 `/market`、贵金属 `/metal`、加密货币 `/crypto`、股票指数 `/equity`、房产 `/realestate` |

## 信息架构（spec 008 / 009）

```
侧边栏（一级菜单）
├── 工作台        /             首页：模块卡片 + 实时摘要
├── 宏观经济      /macro        ← 一级入口，三个子模块共用同一外壳
│     └─ 顶部二级菜单 (SectionTabs)
│          ├── 国家经济数据  /macro     8 组 / 26 项
│          ├── 行业观察      /industry  industry 组 / 10 项
│          └── 跟踪提醒      /alerts    8 条规则评估
├── 资产行情      /market       ← 一级入口，五个子页共用同一外壳 (spec 009)
│     └─ 顶部二级菜单 (SectionTabs, tabs 参数化)
│          ├── 综合对比  /market      归一化合并图 + 全部资产卡
│          ├── 贵金属    /metal       黄金 / 白银
│          ├── 加密货币  /crypto      BTC / ETH / DOGE
│          ├── 股票指数  /equity      道指 / 纳指 / 恒生 / 上证（四市场合一页）
│          └── 房产      /realestate  北京 / 上海房价（月频，禁用日/周粒度）
└── 设置          /settings
```

- 层级用 **Next.js 路由组** `src/app/(macro)/`、`src/app/(market)/` + 共享 `layout.tsx` 表达；URL 不带前缀，见 spec 008 design 决策 1。
- 子页**不各自渲染 Topbar 与滚动容器**，由路由组 `layout.tsx` 统一提供；页面只返回内容节点。
- 一级菜单激活判定：`NavLeaf.match` 列出该菜单对应的全部路径，任一命中即高亮。
- **一个指标只属于一个二级菜单**：`getNationalDashboard()` 与 `getIndustryDashboard()` 的指标集互不相交、并集等于全量（`getMacroDashboard()`）；新增分组时默认归入「国家经济数据」，除非显式排除。

## 代码风格

1. TypeScript `strict` 开启；禁止 `any`，必要时用 `unknown` + 类型守卫。
2. 命名：文件用 kebab-case；类型/组件用 PascalCase；函数/变量用 camelCase；常量用 UPPER_SNAKE_CASE。
3. 服务端代码（仓储、用例）只在 Server Component / Route Handler 中调用，不进入 `"use client"` 文件。
4. 客户端组件必须显式 `"use client"`；图表组件接收纯数据 props，内部不做数据加工。
5. 错误处理：仓储层抛出带上下文的 `Error`；页面级错误由 `error.tsx` 兜底，不让白屏。
6. 注释只解释「为什么」，不解释「是什么」；涉及规格的地方标注 spec 编号。
7. 环境变量：数据库路径用 `MACRO_DB_PATH`（默认 `data/china_economy.db`）/ `MARKET_DB_PATH`（默认 `data/market.db`），不硬编码绝对路径。

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
| 分层 | domain 纯函数 → 单测（spec 006）；application 用例 + 真实 SQLite fixture → 集成测试（spec 007）；presentation 暂不覆盖 |
| 数据隔离 | 集成测试写 `os.tmpdir()` 临时库，通过 `MACRO_DB_PATH` / `MARKET_DB_PATH` 注入，绝不触碰 `data/*.db` |
| 时间稳定性 | fixture 日期相对当前月份生成（`monthOffset`），避免断言随真实时间腐化 |
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

## 行情数据口径（spec 009）

- **日频是唯一事实源**：全部 11 项资产只存日线，周/月/年由 `aggregate()` 纯函数派生（不用 Binance 原生 `1w`/`1M`，避免跨资产周界错位）。
- **数据源**（2026-09-22 本机实测）：金银 = COMEX 期货主力连续（美元/盎司）；加密三币 = Binance 日线；道指/纳指 = 新浪美股指数；恒生 = 东财 `HSI`（备用源新浪 `HSI`，2013-08 起）；上证 = 东财 `sh000001`（备用源新浪，同结构）；京沪房价 = 70 城指数**环比连乘**构造的水平序列（起点 2011-01 = 100，**是价格变动指数、非成交均价**）。东财 push2 端点实测间歇性不可达，提取器带 3 次退避重试 + 指数类自动降级备用源。
- **两套配色语义分离**：K 线/涨跌用「红涨绿跌」token（`--color-up` / `--color-down`）；合并图曲线用资产分类色（`ASSET_COLORS`），不可混用。
- **归一化口径**：各资产以自身基准日收盘价折算为 100（基准日独立，不强行对齐）；日期轴取所选资产交易日并集 + 前向填充，首点之前保持断线（`null`），不用回填值伪造历史。
- **增量策略**：全量幂等 upsert（`INSERT OR REPLACE`）+ `last_date` 短路；上游修正历史时重跑即可自愈。
- **时效判定**：日频资产滞后 >5 天、月频 >60 天（`MARKET_STALE_DAYS` / `MARKET_STALE_DAYS_MONTHLY`）在界面标注 amber 徽标。
- **ECharts 蜡烛数据顺序是 `[open, close, low, high]`**，与 OHLC 直觉顺序不同，写反会静默畸变。
- **图表组件惰性初始化**：首帧可能无数据（画廊载入态），初始化与 `setOption` 必须合并进同一 effect，否则图表永久空白（spec 009 实测踩坑）。
