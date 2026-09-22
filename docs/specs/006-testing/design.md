# Design — 006 testing

## 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 运行器 | Node 内置 `node:test` | 零框架依赖，Node 22 原生支持，输出 TAP 摘要 |
| 断言 | `node:assert/strict` | 同上，无需 chai/jest 生态 |
| TS 加载 | `tsx`（devDependency） | 支持 tsconfig 的 `@/*` 路径别名与 TS 语法，单依赖即可；Next 自身不做测试运行 |
| 位置 | 与被测模块同目录 `*.test.ts` | 就近原则，改代码时不易漏测试 |

命令：`npm test` → `node --import tsx --test src/domain/*.test.ts`。

决策记录:

1. **只测领域层**：domain 无 IO、无框架依赖，测试可纯函数式构造输入输出；infrastructure（SQLite/子进程）与 application（仓储编排）需要替身与临时库，留待后续 spec。
2. **不使用 Jest/Vitest**：本项目为本地单体工具，测试规模小（27 例），引入打包器级测试框架收益低、维护成本高。
3. **测试不参与构建**：Next 只打包被引用模块，测试文件不被引用；但 `next build` 的类型检查会覆盖全 `src/`，因此测试文件也必须类型正确（已通过）。
4. **测试即规格**：断言里固化的是 spec 002/004 的契约（严格比较边界、排序契约、容忍度边界、key 完备性），而非实现细节；改契约需先改 spec。

## 测试矩阵

| 文件 | 覆盖对象 | 用例数 |
|---|---|---|
| `src/domain/alerts.test.ts` | `evaluateRules`（threshold/delta_drop/compare）、`sortAlertItems`、`ALERT_RULES` 自检 | 17 |
| `src/domain/macro.test.ts` | `lagMonths`、`isStale`、`latestPoint`、`describeIndicator`、`TREND_WINDOW` | 10 |

## 目录映射（实现 ↔ 规格追溯）

| 实现 | 对应 AC |
|------|---------|
| `package.json` 的 `test` 脚本 + `tsx` devDependency | US-1 AC1/AC2 |
| `src/domain/alerts.test.ts` | US-2 AC1–AC5 |
| `src/domain/macro.test.ts` | US-3 AC1–AC4 |
| `docs/conventions.md`「测试约定」 | US-1 AC1 |
