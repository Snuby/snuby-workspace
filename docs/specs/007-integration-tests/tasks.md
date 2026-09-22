# Tasks — 007 integration-tests

## A 测试基础设施

- [x] A1 `test` 脚本纳入 `src/application/*.test.ts`（US-1 AC1）
- [x] A2 fixture 生命周期：`before` 建临时库并指向 `MACRO_DB_PATH`，`after` 删库并还原环境变量（US-1 AC2）
- [x] A3 `monthOffset` / `series` 辅助函数，日期相对当前月份生成（US-1 AC3）

## B 用例

- [x] B1 `getMacroDashboard`：指标数/分组、趋势裁剪、latest、staleCount+lag、口径说明、updatedAt（US-2 AC1–AC5）
- [x] B2 `getIndustryDashboard`：分组过滤与行业 staleCount（US-2 AC6）
- [x] B3 `getAlertsReport`：触发排序、summary 计数、lag 标注、消息内容、no_data 降级（US-3 AC1–AC5）
- [x] B4 错误路径：DB 不存在抛 `MacroDataError`（US-4 AC1）

## C 验收

- [x] C1 `npm test` 全量 41 例通过（domain 27 + application 14）
- [x] C2 首轮运行暴露出 fixture 数据错误（PMI 末值算成 50.0、触发项顺序预期写反），已修正——验证测试确实在起作用
- [x] C3 文档一致性：conventions 测试约定更新为分层口径、规格索引补 007、spec 目录四文件齐备
