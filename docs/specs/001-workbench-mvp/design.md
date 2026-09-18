# Design — 001 workbench-mvp

## 总体架构

```
Python 管道 (scripts/fetch_data.py, akshare)
        │ 写入 (幂等 upsert)
        ▼
SQLite  data/china_economy.db          ← 单一事实源
        │ 只读 (node:sqlite)
        ▼
Infrastructure  src/infrastructure/sqlite-macro-repository.ts
        ▼
Application     src/application/macro-service.ts   (分组、排序、视图模型组装)
        ▼
Presentation    Route Handler (GET /api/macro/indicators)
                Server Component (app/page.tsx, app/macro/page.tsx)
                Client Components (Sidebar, TrendChart)
```

决策记录:

1. **SQLite 访问用 Node 内置 `node:sqlite`**，不引入 better-sqlite3（避免原生编译依赖）。仓储以 `DatabaseSync` 只读打开。
2. **Python 管道沿用原静态版脚本**（已验证 25 指标抓取），仅改为相对路径定位 DB 并迁移到 `scripts/`。抓取与读取解耦：Next.js 永不写库。
3. **页面用 Server Component 直接调 application 层**（同进程，无需自取 HTTP）；API 路由面向未来客户端轮询场景，二者共用同一用例，保证口径一致。
4. **图表选 ECharts**：用 `echarts/core` 按需注册（LineChart / Grid / Tooltip），封装为 `<TrendChart>` 客户端组件，props 只收 `{ dates, values, unit }`。
5. **路由结构**: `/`（工作台首页）、`/macro`（国家经济数据）、`/settings`、`/api/macro/indicators`。菜单状态由 `Sidebar` 客户端组件用 `usePathname` 高亮，页面跳转用 `next/link`（保留整页数据获取，简单可靠）。

## 领域模型（src/domain/macro.ts）

```ts
type SeriesPoint = { date: string; value: number };

type Indicator = {
  key: string;          // 如 gdp_yoy
  name: string;         // 如 "GDP 同比增速"
  unit: string;         // 如 "%"
  freq: string;         // 如 "月度"
  group: IndicatorGroupId;
  description: string;  // 口径说明
  series: SeriesPoint[]; // 按 date 升序
};

type IndicatorGroupId = "growth" | "consumption" | "trade" | "price"
  | "money" | "confidence" | "realestate" | "risk";

type IndicatorGroup = { id: IndicatorGroupId; label: string };
```

## API 契约 — GET /api/macro/indicators

响应 200:

```json
{
  "updatedAt": "2026-09-18T09:46:00",
  "groups": [{ "id": "growth", "label": "总量与增长" }],
  "indicators": [
    {
      "key": "gdp_yoy", "name": "GDP 同比增速", "unit": "%",
      "freq": "季度", "group": "growth", "description": "...",
      "latest": { "date": "2026-06", "value": 4.7 },
      "series": [{ "date": "2026-06", "value": 4.7 }]
    }
  ]
}
```

响应 500: `{ "error": "<message>" }`（DB 缺失/损坏时）。

序列字段说明: API 返回完整升序序列；页面渲染时由应用层截取近 36 期（`TREND_WINDOW = 36`）。

## 错误处理

- 仓储打开 DB 失败 → 抛 `MacroDataError` → 页面 `error.tsx` 呈现「数据不可用，请先运行 npm run fetch」；API 返回 500 JSON。
- 指标缺 series → 跳过该指标的 latest 计算，卡片仍渲染但显示「暂无数据」。

## 目录映射（实现 ↔ 规格追溯）

| 实现 | 对应 AC |
|------|---------|
| `src/components/workbench/sidebar.tsx` | US-1 AC1/AC2 |
| `src/app/page.tsx` | US-1 AC3 |
| `src/app/settings/page.tsx` | US-1 AC4 |
| `src/app/macro/page.tsx` + `src/components/macro/*` | US-2 AC1/AC2/AC5 |
| `src/application/macro-service.ts` + `src/infrastructure/*` | US-2 AC3 |
| `src/app/api/macro/indicators/route.ts` | US-2 AC4 |
| `scripts/fetch_data.py` | US-3 AC1/AC2 |
| 自动化任务（每周一 09:00） | US-3 AC3 |
