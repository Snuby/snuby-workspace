# Requirements — 006 testing

## 用户故事

### US-1 测试运行方式

作为开发者，我用一条命令即可运行全部单测，且不引入重量级测试框架。

- [x] AC1: `npm test` 运行 `src/domain/*.test.ts`，使用 Node 内置测试运行器（`node:test` + `node:assert`），仅以 `tsx` 作为 TS 加载器。
- [x] AC2: 测试文件与被测模块同目录（`*.test.ts`），不进生产构建产物。

### US-2 告警规则测试（spec 002 核心逻辑）

- [x] AC1: `threshold` 规则覆盖：低于阈值触发、**等于阈值不触发**（严格比较）、`above` 方向语义、指标缺失/无数据 → `no_data`。
- [x] AC2: `delta_drop` 规则覆盖：回落达阈值触发、回落不足不触发、上升不触发、单数据点 → `no_data`。
- [x] AC3: `compare` 规则覆盖：主指标低于对比指标触发并输出剪刀差、反之为 normal、对比指标缺失 → `no_data`。
- [x] AC4: `sortAlertItems` 排序契约：status 优先（triggered → normal → no_data）→ triggered 内 danger 优先 → 其余保持规则表顺序，且不丢条目。
- [x] AC5: 规则表自检：`ruleId` 唯一、severity 合法、label/rationale 非空、`indicatorKey` 必须是已知指标（防止改 key 后规则静默失效）。

### US-3 时效判定测试（spec 004 核心逻辑）

- [x] AC1: `lagMonths` 覆盖同月/上月/跨年，兼容 `YYYY-MM` 与 `YYYY-MM-DD`，非法月份不产生 NaN。
- [x] AC2: `isStale` 覆盖三档容忍度边界（月度 3、季度 6、半年度 8），未知频率按月度口径回退。
- [x] AC3: `latestPoint` 覆盖取末位与空序列。
- [x] AC4: `describeIndicator` 覆盖 36 项指标 key 全部有口径说明（防止新增指标漏写文案）。

## 影响

- 无生产代码变更；`npm run build` 需在测试文件存在的情况下仍然通过（TypeScript 类型检查）。
