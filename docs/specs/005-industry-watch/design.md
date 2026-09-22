# Design — 005 industry-watch

## 数据源（均由 akshare 提供，已实测时效）

| 指标 key | 名称 | akshare 接口 | 取值列 | 频率 | 最新 |
|---|---|---|---|---|---|
| lpi_index | 物流景气指数 | `macro_china_lpi_index` | 最新值 | 月度 | 2026-08 |
| pax_load_factor | 民航客座率 | `macro_china_passenger_load_factor` | 客座率 | 月度 | 2026-08 |
| freight_rail_yoy | 铁路货运量同比 | `macro_china_society_traffic_volume` | 货运量同比增长（统计对象=铁路） | 月度 | 2026-08 |
| freight_highway_yoy | 公路货运量同比 | 同上（统计对象=公路） | 货运量同比增长 | 月度 | 2026-08 |
| elec_yoy | 全社会用电量同比 | `macro_china_society_electricity` | 全社会用电量同比 | 月度 | 2026-08 |
| elec_secondary_yoy | 第二产业用电量同比 | 同上 | 第二产业用电量同比 | 月度 | 2026-08 |
| elec_tertiary_yoy | 第三产业用电量同比 | 同上 | 第三产业用电量同比 | 月度 | 2026-08 |
| commodity_price_index | 大宗商品价格指数 | `macro_china_commodity_price_index` | 最新值 | 日频→月末 | 2026-09-21 |
| agri_price_index | 农产品批发价格指数 | `macro_china_agricultural_product` | 最新值 | 日频→月末 | 2026-09-21 |
| construction_index | 建材指数 | `macro_china_construction_index` | 最新值 | 日频→月末 | 2026-09-21 |

决策记录:

1. **日频指标月度化**（月末采样）：取每月最后一个交易日观测值，使 36 期窗口语义统一为「近 36 个月」。实现为 `month_end_sample(rows)`：按 `YYYY-MM` 分组取组内最后一条（源按日期升序）。
2. **`YYYY.M` 日期归一**：用电量/货运量/客座率的 `统计时间` 形如 `2026.8`、`2003.12`，统一转换为 `YYYY-MM`（月份补零），与既有指标一致，避免排序错乱。
3. **不新增数据表**：行业指标与宏观指标同构（`Indicator`），直接复用 `series`/`meta`，仅新增分组 `industry`，页面与卡片零改动复用。
4. **告警规则不扩展**：行业指标波动性强，阈值规则需要单独设计，留待后续 spec。
5. **分行业增加值的替代说明**：统计局分行业数据接口在当前网络被 WAF 拦截（spec 004 已评估），故以用电量分产业、货运量分运输方式的实物量口径替代。

## 领域模型扩展（src/domain/macro.ts）

```ts
type IndicatorGroupId = ... | "industry";   // 追加
INDICATOR_GROUPS 追加 { id: "industry", label: "行业景气与高频" }  // 置于分组末尾
INDICATOR_DESCRIPTIONS 追加 10 条口径说明
```

## 数据管道扩展（scripts/fetch_data.py）

新增提取器：`extract_lpi` / `extract_pax_load_factor` / `extract_freight(mode)` / `extract_electricity()` / `extract_daily_month_end(func)`，
并新增公共辅助 `ym_to_date("2026.8") -> "2026-08"` 与 `month_end_sample(rows)`。

## 页面

- `/industry`：与 `/macro` 同构（Topbar + 分组区段 + 指标卡网格），仅渲染 `industry` 分组。
- 侧边栏「数据观察」→「国家经济数据」「行业观察」「跟踪提醒」三项。
- 首页「行业观察」卡片：显示指标数与最新月份，链接 `/industry`。

## 目录映射（实现 ↔ 规格追溯）

| 实现 | 对应 AC |
|------|---------|
| `scripts/fetch_data.py`（新提取器 + 10 项任务） | US-1 AC1/AC2/AC3 |
| `src/domain/macro.ts`（分组 + 口径说明） | US-1 AC1 |
| `src/app/industry/page.tsx` + `error.tsx` | US-2 AC1/AC2/AC3 |
| `src/components/workbench/sidebar.tsx` | US-2 AC1 |
| `src/application/macro-service.ts`（`getIndustryDashboard`）+ `src/app/page.tsx` | US-3 AC1 |
