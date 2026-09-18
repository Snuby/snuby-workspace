# Design — 002 macro-alerts

## 数据流（复用 001 数据层，只读）

```
SQLite series 表（现状不变）
        ▼
Infrastructure  sqlite-macro-repository.ts（复用 loadAll）
        ▼
Application     alert-service.ts（加载规则 → 评估 → 视图模型）
        ▼
Presentation    GET /api/macro/alerts
                app/alerts/page.tsx + app/page.tsx 首页卡片
```

决策记录:

1. **规则 = 代码内配置**（`src/domain/alerts.ts` 导出常量 `ALERT_RULES`），不建表、不做 UI 管理。理由: 首批规则稳定且量少（8 条），YAGNI；未来自定义需求出现时走 spec 003「规则存储」。
2. **实时评估，不落库**。每次请求基于最新数据现算（25 指标 × 8 规则，纯内存，微秒级）；不做历史告警表，避免管道与评估耦合。
3. **规则类型 MVP 只做两种**: `threshold`（op: below / above）与 `delta_drop`（最新值 − 前值 ≤ −阈值，仅同向）。复合规则（如 M1 vs M2）通过「关联第二指标」的 `compare` 变体实现，不做通用表达式引擎。
4. **评估纯函数**放 domain 层（`evaluateRules(rules, indicators)`），application 层只做编排，便于单测与复用。

## 领域模型（src/domain/alerts.ts）

```ts
type AlertSeverity = "warning" | "danger";
type AlertStatus = "triggered" | "normal" | "no_data";

type AlertRule =
  | { ruleId: string; indicatorKey: string; kind: "threshold";
      op: "below" | "above"; threshold: number; severity: AlertSeverity;
      label: string; rationale: string }
  | { ruleId: string; indicatorKey: string; kind: "delta_drop";
      threshold: number; severity: AlertSeverity;
      label: string; rationale: string }
  | { ruleId: string; indicatorKey: "m1_yoy"; kind: "compare";
      compareToKey: "m2_yoy"; severity: AlertSeverity;
      label: string; rationale: string };  // m1_yoy < m2_yoy 触发

type AlertItem = {
  rule: AlertRule;
  status: AlertStatus;
  latest?: { date: string; value: number };   // 主指标最新点
  previous?: { date: string; value: number }; // delta 规则用
  message: string;  // 如 "PMI 49.8（2026-08），跌破荣枯线 50"
};
```

## 首批规则表（label / ruleId / 判定）

| ruleId | 指标 | 判定 | 级别 |
|---|---|---|---|
| pmi-below-50 | pmi_mfg | threshold below 50 | warning |
| cpi-negative | cpi_yoy | threshold below 0 | warning |
| ppi-negative | ppi_yoy | threshold below 0 | warning |
| m1-m2-scissor | m1_yoy | compare m2_yoy | warning |
| unemployment-high | unemployment | threshold above 5.5 | danger |
| house-price-negative | house_price_yoy | threshold below 0 | warning |
| export-plunge | export_yoy | delta_drop 5 | danger |
| gdp-slowdown | gdp_yoy | threshold below 4.5 | danger |

## API 契约 — GET /api/macro/alerts

响应 200:

```json
{
  "summary": { "triggered": 3, "danger": 1, "warning": 2, "normal": 4, "noData": 1 },
  "items": [
    {
      "ruleId": "pmi-below-50", "label": "制造业 PMI 跌破荣枯线",
      "indicatorKey": "pmi_mfg", "indicatorName": "制造业 PMI",
      "status": "triggered", "severity": "warning",
      "latest": { "date": "2026-08", "value": 49.8 },
      "message": "PMI 49.8（2026-08），低于荣枯线 50"
    }
  ]
}
```

排序契约: `items` 按 status（triggered → normal → no_data），triggered 内按 severity（danger → warning）→ 规则表原始顺序。

## UI

- `/alerts` 页: 顶部统计条（与 AC 对应），下方三段列表（触发中 / 正常 / 无数据）。触发项左侧色条: danger 红、warning 琥珀；复用设计 token（globals.css 变量）。
- 首页卡片「跟踪提醒」: 由占位态改为 Server Component 渲染摘要，`<Link href="/alerts">`。
- Sidebar: NAV 的「数据观察」group 增加 `{ href: "/alerts", label: "跟踪提醒" }`。

## 错误处理

- DB 缺失 → 复用 `MacroDataError` 模式: 页面提示「数据不可用，请先运行 npm run fetch」，API 返回 500。
- 指标 series 长度 < 2 → `delta`/`compare` 规则返回 `no_data`。

## 目录映射（实现 ↔ 规格追溯）

| 实现 | 对应 AC |
|------|---------|
| `src/domain/alerts.ts`（规则 + 评估纯函数） | US-1 AC1/AC2/AC3 |
| `src/application/alert-service.ts` | US-1 / US-4 共用用例 |
| `src/app/alerts/page.tsx` + sidebar 更新 | US-2 AC1/AC2/AC4 |
| `src/app/page.tsx` 卡片改造 | US-3 AC1/AC2 |
| `src/app/api/macro/alerts/route.ts` | US-4 AC1 |
| `app/alerts/error.tsx` | US-2 AC4 |
