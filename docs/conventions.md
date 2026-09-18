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

## 代码风格

1. TypeScript `strict` 开启；禁止 `any`，必要时用 `unknown` + 类型守卫。
2. 命名：文件用 kebab-case；类型/组件用 PascalCase；函数/变量用 camelCase；常量用 UPPER_SNAKE_CASE。
3. 服务端代码（仓储、用例）只在 Server Component / Route Handler 中调用，不进入 `"use client"` 文件。
4. 客户端组件必须显式 `"use client"`；图表组件接收纯数据 props，内部不做数据加工。
5. 错误处理：仓储层抛出带上下文的 `Error`；页面级错误由 `error.tsx` 兜底，不让白屏。
6. 注释只解释「为什么」，不解释「是什么」；涉及规格的地方标注 spec 编号。
7. 环境变量：数据库路径用 `MACRO_DB_PATH`（默认 `data/china_economy.db`），不硬编码绝对路径。

## Git 约定

- 分支：`feat/<spec编号>-<slug>`，如 `feat/001-macro-dashboard`。
- 提交信息：`<type>(<scope>): <subject>`，type ∈ feat/fix/docs/refactor/chore。

## 数据口径备忘

- 东财报告式接口（GDP/CPI/PPI/PMI/工业增加值/外储）数据滞后约一年，属数据源限制。
- `macro_china_gdp` 官方源只有 Q1 单季 + 累计期，累计期统一映射到季度末月份（03/06/09/12）。
- 70 城房价同比 = 各城市「新建商品住宅价格指数-同比」减 100 后的均值。
- 贸易差额 = (当月出口额 − 当月进口额) / 1e5，单位亿美元（源单位千美元）。
