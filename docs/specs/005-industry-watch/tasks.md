# Tasks — 005 industry-watch

## A 数据管道

- [x] A1 辅助函数 `ym_to_date`（`2026.8` → `2026-08`）、`month_end_sample`（日频月末采样）
- [x] A2 提取器：`extract_lpi` / `extract_pax_load_factor` / `extract_freight(mode)` / `extract_electricity` / `extract_daily_month_end`
- [x] A3 任务表新增 10 项行业指标，dim = `industry`（US-1 AC1/AC2/AC3）

## B 领域与应用层

- [x] B1 `IndicatorGroupId` 增加 `industry`，`INDICATOR_GROUPS` 追加「行业景气与高频」
- [x] B2 `INDICATOR_DESCRIPTIONS` 追加 10 条口径说明
- [x] B3 `getIndustryDashboard()`（复用 `getMacroDashboard` 过滤 industry 分组）

## C 表现层

- [x] C1 `/industry` 页 + `error.tsx`（复用指标卡与趋势图）（US-2 AC1/AC2/AC3）
- [x] C2 侧边栏新增「行业观察」菜单项
- [x] C3 首页「行业观察」卡片由占位升级为入口（指标数 + 最新期）（US-3 AC1）
- [x] C4 `fetch-service` / `fetch-button` 进度总数占位更新为 36

## D 验收

- [x] D1 全量抓取 36/36 成功；行业 10 项入库，最新期 2026-08 / 2026-09-21
- [x] D2 `npm run build` 通过；`/`、`/macro`、`/industry`、`/alerts`、`/settings` 全部 200
- [x] D3 文档一致性：README 指标数与路由、conventions 口径备忘、spec 索引同步
