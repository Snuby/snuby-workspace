# Tasks — 001 workbench-mvp

## A 数据管道

- [x] A1 迁移 `fetch_data.py` 到 `scripts/`，DB 路径改为 `<项目根>/data/`（US-3 AC1）
- [x] A2 复制已抓取的 `china_economy.db` 到 `data/` 并验证脚本幂等重跑（US-3 AC2）
- [x] A3 定时任务切换到新脚本路径（US-3 AC3）

## B 领域与应用层

- [x] B1 `src/domain/macro.ts`：领域类型 + 分组常量（design.md 领域模型）
- [x] B2 `src/infrastructure/sqlite-macro-repository.ts`：node:sqlite 只读仓储 + `MacroDataError`
- [x] B3 `src/application/macro-service.ts`：用例（读取 → 校验 → 视图模型），近 36 期窗口常量

## C 表现层

- [x] C1 布局与设计 token：`src/app/globals.css`、`layout.tsx`
- [x] C2 Sidebar 客户端组件（usePathname 高亮 + 分组结构）（US-1 AC1/AC2）
- [x] C3 工作台首页模块卡片（US-1 AC3）
- [x] C4 `/macro` 页：分组渲染 + 指标卡（US-2 AC1/AC2/AC5）
- [x] C5 `<TrendChart>` ECharts 封装（近 36 期折线）（US-2 AC2）
- [x] C6 `/settings` 页（US-1 AC4）
- [x] C7 `GET /api/macro/indicators`（US-2 AC4）
- [x] C8 `app/macro/error.tsx` 错误兜底（US-2 AC5）

## D 验收

- [x] D1 `npm run build` 通过、eslint 无 error
- [x] D2 `npm run dev` 手工验收全部 AC
- [x] D3 文档一致性检查（术语、API 契约、目录映射与代码一致）
