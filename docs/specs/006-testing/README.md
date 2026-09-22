# Spec 006 — testing（领域层单测体系）

状态: **done**

## 目标

为领域层纯函数建立自动化测试，兑现 spec 002/004 设计中「纯函数便于单测」的承诺：告警规则评估与排序、数据时效判定、指标口径字典完整性。

非目标: 不做 UI 快照测试、不做端到端浏览器测试、不覆盖 infra/application 层（依赖 SQLite 与子进程，属集成范畴，后续需要时另立 spec）。

## 依赖

- 复用现有 `src/domain/macro.ts` 与 `src/domain/alerts.ts`（无需改动生产代码）。
