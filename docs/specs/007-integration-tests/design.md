# Design — 007 integration-tests

## 测试策略分层

```
domain      纯函数, 无 IO                    → 单测 (spec 006, 27 例)
application 用例编排 + 真实 SQLite fixture   → 集成测试 (spec 007, 14 例)
presentation React 渲染                      → 暂不覆盖 (非目标)
scripts     Python 数据管道                  → 由真实抓取验收 (spec 003/004/005 手工验收)
```

## 决策记录

1. **用真实 SQLite 而非 mock 仓储**：仓储只做「行 → 领域对象」映射（spec 001 决策），mock 掉它等于不测这条链路；用 Node 内置 `node:sqlite` 建临时库成本极低，收益是能覆盖「列名/类型/排序」这类真实故障点。
2. **`MACRO_DB_PATH` 是天然注入点**：仓储每次调用都重新解析该环境变量（spec 001 约定），因此测试只需在 `before` 中指向临时文件，无需改生产代码。用例结束后 `delete process.env.MACRO_DB_PATH`，避免影响同进程其它用例。
3. **fixture 日期相对化**：以「当前月份偏移 N 个月」生成日期（`monthOffset`），使「滞后 6 个月的季度指标判为 stale」这类断言在任何时间运行都成立——否则测试会在几个月后自然失效（正是 spec 004 修的那类问题）。
4. **刻意留一个缺失指标**：fixture 不放 `ppi_yoy`，用于验证「规则指向的指标不在库中」时降级为 `no_data` 而非抛错。这是真实场景（数据源失效导致整个指标缺失）的回归保护。
5. **断言业务契约而非实现**：例如触发项顺序断言的是 spec 002 定义的排序契约（danger → 规则表顺序），而非 `sortAlertItems` 的内部实现。
6. **每个测试文件独立进程**：`node --test` 默认按文件隔离进程，因此两个测试文件可各自设置 `MACRO_DB_PATH` 而互不干扰。

## fixture 构成（`src/application/macro-service.test.ts`）

| 指标 | 设计 | 覆盖点 |
|---|---|---|
| `pmi_mfg` | 6 期 48.8→49.8 | threshold 触发（最新期低于 50） |
| `m1_yoy` / `m2_yoy` | M1 4.1 < M2 7.6 | compare 触发（剪刀差） |
| `export_yoy` | 12.0 → 5.0 | delta_drop 触发（回落 7pct） |
| `cpi_yoy` / `unemployment` / `house_price_yoy` | 均未越界 | normal 路径 |
| `gdp_yoy` | 季度、最新期滞后 6 个月、值 4.0 | danger 排序 + stale 标注 |
| `elec_yoy` | 50 期、`dim=industry` | 趋势窗口裁剪 + 行业分组过滤 |
| （缺 `ppi_yoy`） | — | no_data 降级 |

## 目录映射（实现 ↔ 规格追溯）

| 实现 | 对应 AC |
|------|---------|
| `package.json` 的 `test` 脚本 | US-1 AC1 |
| `src/application/macro-service.test.ts`（fixture + before/after 生命周期） | US-1 AC2/AC3 |
| 同文件 `getMacroDashboard` 用例组 | US-2 AC1–AC5 |
| 同文件 `getIndustryDashboard` 用例组 | US-2 AC6 |
| 同文件 `getAlertsReport` 用例组 | US-3 AC1–AC5 |
| 同文件「错误处理」用例组 | US-4 AC1 |
