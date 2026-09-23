# 011 — 任务

> 状态: **implementing** —— 用户直接指令（2026-09-23），规格与实现并行推进。

## A. 规格

- [ ] A1 spec 四件套（README / requirements / design / tasks）
- [ ] A2 数据源可行性实测（AA 直嵌 ✅ / OR XFO+CSP ❌，已记入 README）

## B. 表现层

- [ ] B1 `src/app/(leaderboard)/layout.tsx` — Topbar + SectionTabs（两个 tab）
- [ ] B2 `/ai-leaderboard` 默认页（AA iframe）
- [ ] B3 `/ai-leaderboard/openrouter` 子页（OR 代理 iframe）
- [ ] B4 `src/components/leaderboard/leaderboard-frame.tsx` — iframe 组件 + 外链说明条
- [ ] B5 侧边栏一级菜单「AI 模型榜单」（新图标 + match 两路径）
- [ ] B6 首页模块卡片

## C. OpenRouter 自渲染（用户批复方案，替代代理）

- [x] C0 代理方案实测与废弃：`/or-proxy` 可显示页面框架，但动态数据层（clerk 认证在 iframe 下挂起）0 个 API 请求，确认不可行 → 删除代理与 rewrites（变更记录见 README）
- [x] C1 `src/domain/or-rankings.ts` — aggregateRankings / shortModelName / formatTokens 纯函数
- [x] C2 `src/domain/or-rankings.test.ts` — 聚合/格式化单测
- [x] C3 `openrouter/page.tsx` — 服务端 fetch 公开 API + 聚合 + 错误态（no-store）
- [x] C4 `src/components/leaderboard/openrouter-board.tsx` — ECharts 横向柱 Top 15 + 表格 Top 50 + 官方直链

## D. 验证

- [x] D1 `npm test` 全绿（原 100 例 + or-rankings 新增）
- [x] D2 `next build` 通过
- [x] D3 浏览器目检：AA 页 iframe 真实渲染（AC-B）
- [x] D4 浏览器目检：OR 页图表与表格渲染、数据截至日期正确（AC-C）
- [x] D5 首页与既有板块 200 回归（AC-E）

## E. 文档与提交

- [ ] E1 `docs/README.md` 索引补 011
- [ ] E2 `docs/conventions.md` 术语表/信息架构补「AI 模型榜单」
- [ ] E3 根 `README.md` 板块说明
- [ ] E4 spec 011 状态转 done + 变更记录
- [ ] E5 git 提交（不含他人未提交文件与 `.workbuddy/`）

## 变更记录

- 2026-09-23: 初版（implementing）。
