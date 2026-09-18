# Tasks — 002 macro-alerts

## A 领域与应用层

- [ ] A1 `src/domain/alerts.ts`：`AlertRule` / `AlertItem` 类型 + `ALERT_RULES` 常量 + `evaluateRules` 纯函数（design.md 领域模型）
- [ ] A2 `src/application/alert-service.ts`：编排（复用 macro 读取 → 评估 → 排序 → 摘要）

## B 表现层

- [ ] B1 Sidebar 增加「跟踪提醒」菜单项；conventions.md 术语表补 `AlertRule` / `AlertItem`
- [ ] B2 `/alerts` 页 + `error.tsx`：统计条 + 三段状态列表（US-2）
- [ ] B3 首页「跟踪提醒」卡片升级为实时摘要 + 链接（US-3）
- [ ] B4 `GET /api/macro/alerts`（US-4）

## C 验收

- [ ] C1 `npm run build` 通过、eslint 无 error
- [ ] C2 手工核对全部 AC（含触发/正常/无数据三种状态的实际渲染）
- [ ] C3 文档一致性检查（API 契约、规则表、目录映射与代码一致），spec 状态置 done
