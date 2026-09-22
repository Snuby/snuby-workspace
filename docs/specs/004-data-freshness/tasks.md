# Tasks — 004 data-freshness

## A 数据源

- [x] A1 `fetch_data.py` 新增官方源提取器：`extract_gyzjz` / `extract_cpi` / `extract_ppi` / `extract_pmi` / `extract_fx_reserves`（US-1 AC1）
- [x] A2 任务表切换到新源，`fx_reserves` 频率改月度（US-1 AC1）
- [x] A3 清理 6 指标旧源遗留行（1829 行）后重抓（US-1 AC2）
- [x] A4 新增 `consumer_confidence` 指标（US-1 AC3）

## B 时效性

- [x] B1 `domain/macro.ts`：`STALE_LAG_MONTHS` + `lagMonths` + `isStale`（US-2 AC1）
- [x] B2 `macro-service`：视图增加 `lag`、看板增加 `staleCount`
- [x] B3 指标卡滞后徽标 + `/macro` 页头滞后汇总（US-2 AC2）
- [x] B4 `/alerts` 规则项滞后徽标（US-2 AC3）
- [x] B5 `INDICATOR_DESCRIPTIONS` 字典（26 项）接入卡片口径说明（US-3 AC1）

## C 验收

- [x] C1 全量重抓 26/26 成功；复核最新日期：22 项为当期最新，3 项标注滞后（企业景气 6 月、社融 5 月、国房景气 9 月）
- [x] C2 `npm run build` 通过，四个页面 + alerts API 200
- [x] C3 文档一致性：conventions 口径备忘、README 指标数、spec 索引同步
