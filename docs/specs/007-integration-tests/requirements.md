# Requirements — 007 integration-tests

## 用户故事

### US-1 用例层测试运行

作为开发者，`npm test` 同时运行领域单测与用例集成测试，集成测试使用临时 SQLite，不污染真实数据库。

- [x] AC1: `npm test` 运行 `src/domain/*.test.ts` 与 `src/application/*.test.ts`。
- [x] AC2: fixture 写入系统临时目录（`os.tmpdir()`），用例结束后删除；不读取/修改 `data/china_economy.db`。
- [x] AC3: fixture 日期基于「当前月份偏移」生成，使时效类断言长期稳定（不随真实时间腐化）。

### US-2 看板组装

- [x] AC1: 指标数与分组来自 `meta` 表；分组顺序遵循 `INDICATOR_GROUPS`。
- [x] AC2: 趋势序列裁剪到 `TREND_WINDOW=36`，完整序列仍保留在 `series` 字段。
- [x] AC3: `latest` 取裁剪后序列末位；`updatedAt` 来自 `meta.updated_at`。
- [x] AC4: `staleCount` / `lag` 只对超容忍度指标生效（fixture 中季度指标滞后 6 个月 → 判定滞后；月度新鲜指标 `lag` 为 null）。
- [x] AC5: 口径说明由领域字典注入，全部指标非空。
- [x] AC6: `getIndustryDashboard` 只返回 `industry` 分组，`staleCount` 按行业指标自身计算。

### US-3 告警端到端

- [x] AC1: 触发项排序符合 spec 002 契约（danger 优先 → 同级按规则表顺序）。
- [x] AC2: `summary` 各状态计数之和等于规则总数。
- [x] AC3: 依赖滞后指标的规则带 `lag` 标注，新鲜指标规则 `lag` 为 null。
- [x] AC4: 规则项 `indicatorName` 来自 `meta.name`，`message` 含最新值与日期。
- [x] AC5: fixture 中**故意缺失**的指标对应规则呈 `no_data`（`message` = 暂无数据，`latest` = null），页面不报错。

### US-4 错误路径

- [x] AC1: 数据库文件不存在时，看板与告警用例均抛 `MacroDataError`，不返回半成品数据（页面据此渲染「数据不可用」）。
