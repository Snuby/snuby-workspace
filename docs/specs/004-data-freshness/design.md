# Design — 004 data-freshness

## 数据源替换对照（scripts/fetch_data.py）

| 指标 key | 旧源（东财报告式，滞后） | 新源（官方/月度） | 取值列 |
|---|---|---|---|
| ind_yoy | `macro_china_industrial_production_yoy` | `macro_china_gyzjz` | 同比增长 |
| cpi_yoy | `macro_china_cpi_yearly` | `macro_china_cpi` | 全国-同比增长 |
| ppi_yoy | `macro_china_ppi_yearly` | `macro_china_ppi` | 当月同比增长 |
| pmi_mfg | `macro_china_pmi_yearly` | `macro_china_pmi` | 制造业-指数 |
| pmi_non_mfg | `macro_china_non_man_pmi` | `macro_china_pmi` | 非制造业-指数 |
| fx_reserves | `macro_china_fx_reserves_yearly`（半年度） | `macro_china_fx_gold` | 国家外汇储备-数值（亿美元） |

决策记录:

1. **官方源返回降序**（最新在前），提取器统一 `sorted(key=date)` 归一为升序后入库，与仓储 `ORDER BY date ASC` 一致。
2. **旧行清理**：报告式源日期形如 `2025-08-09`（日报日期），官方源为 `2026-08`（月份），两者混存会污染序列与趋势图。替换时按指标删除 `series` 中旧行（本次 6 指标共清 1829 行）后重抓。
3. **无法替换的 3 项保留并标注**：
   - `shrzgm` 社融增量：akshare 免费源（商务数据中心口径）止于 2026-04；
   - `boom_index` 企业景气指数：东财季度序列，更新慢约两季度；
   - `real_estate_index` 国房景气指数：东财序列止于 2025-12。
   不静默隐藏，改为界面标注滞后月数（US-2）。
4. **新增 `consumer_confidence`**（消费者信心指数，月度，东财 `macro_china_xfzxx`），最新 2026-07，补上信心维度的新鲜数据。

## 时效性判定（src/domain/macro.ts）

```ts
export const STALE_LAG_MONTHS: Record<string, number> = { 月度: 3, 季度: 6, 半年度: 8 };
export function lagMonths(latestDate: string, ref?: Date): number;
export function isStale(latestDate: string, freq: string, ref?: Date): boolean;
```

判定按「月份差 ≥ 该频率容忍度」：月度容忍 3 个月（给发布延迟留 2 个月余量）、季度 6 个月、半年度 8 个月。日期解析只取 `YYYY-MM` 前缀，兼容 `2026-08` / `2026-08-01` / `2026-08-20` 三种格式。

## 视图模型扩展

- `IndicatorView.lag: number | null` — 滞后月数（未滞后为 null）；`MacroDashboard.staleCount`。
- `AlertView.lag: number | null` — 规则所依赖指标的滞后月数（spec 002 的补充字段）。
- `Indicator.description` 由 `describeIndicator(key)` 提供（领域层字典，26 项），此前仓储层写死空串。

## 目录映射（实现 ↔ 规格追溯）

| 实现 | 对应 AC |
|------|---------|
| `scripts/fetch_data.py` 提取器 + 任务表 | US-1 AC1/AC2/AC3 |
| `src/domain/macro.ts`（`isStale` / `lagMonths` / `INDICATOR_DESCRIPTIONS`） | US-2 AC1 / US-3 AC1 |
| `src/application/macro-service.ts`（`lag` / `staleCount` / description） | US-2 AC2 / US-3 AC1 |
| `src/components/macro/indicator-card.tsx`、`src/app/macro/page.tsx` | US-2 AC2 |
| `src/application/alert-service.ts`、`src/app/alerts/page.tsx` | US-2 AC3 |
