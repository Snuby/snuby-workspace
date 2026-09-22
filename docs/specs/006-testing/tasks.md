# Tasks — 006 testing

## A 测试基础设施

- [x] A1 安装 `tsx`（devDependency），`package.json` 增加 `test` 脚本（US-1 AC1）
- [x] A2 明确测试文件位置约定并写入 `docs/conventions.md`（US-1 AC2）

## B 用例

- [x] B1 `src/domain/alerts.test.ts`：threshold / delta_drop / compare / 排序 / 规则表自检（US-2 AC1–AC5）
- [x] B2 `src/domain/macro.test.ts`：lagMonths / isStale / latestPoint / describeIndicator / TREND_WINDOW（US-3 AC1–AC4）

## C 验收

- [x] C1 `npm test`：27 例全绿（10 suites，0 fail）
- [x] C2 `npm run build` 在测试文件存在下仍通过（类型检查）
- [x] C3 五个页面重新验证 200；文档一致性（conventions 测试约定、规格索引、spec 目录文件齐备）
