# 008 — 任务

## A. 用例层分层

- [x] A1 `macro-service.ts`：抽出私有 `buildDashboard(groupIds)`, 统一分组过滤与 `staleCount` 口径（design 决策 5）
- [x] A2 新增 `getNationalDashboard()`（8 组 / 26 项, 排除 industry）；`getIndustryDashboard()` 复用同一构建函数（US-3 AC1/AC2/AC4）
- [x] A3 `getMacroDashboard()` 保留全量语义（US-3 AC5, API 契约不变）

## B. 侧边栏收敛

- [x] B1 `sidebar.tsx`：`NavLeaf` 支持 `match?: readonly string[]`，激活判定改为 `match ? includes : 相等`（US-1 AC2）
- [x] B2 `NAV` 移除 `数据观察` 分组，改为「工作台 / 宏观经济 / 设置」三项（US-1 AC1/AC3）

## C. 路由组与共享外壳

- [x] C1 新建 `src/app/(macro)/`，把 `macro` / `industry` / `alerts` 三个目录整体迁入（URL 不变，design 决策 1）
- [x] C2 新建 `src/components/workbench/section-tabs.tsx`：三 Tab + `usePathname` 选中态 + 右侧 `action` 插槽（US-2 AC1–AC4）
- [x] C3 新建 `(macro)/layout.tsx`：`Topbar("宏观经济")` + `SectionTabs(action=FetchButton)` + 滚动容器（US-2 AC2, design 决策 2）

## D. 页面改造

- [x] D1 `(macro)/macro/page.tsx`：改用 `getNationalDashboard`；删除自身 Topbar 与滚动容器（US-3 AC1）
- [x] D2 `(macro)/industry/page.tsx`：删除自身 Topbar 与滚动容器（US-3 AC2）
- [x] D3 `(macro)/alerts/page.tsx`：删除自身 Topbar 与滚动容器；顶部新增模块自述一句话（US-4 AC1/AC2）
- [x] D4 三个 `error.tsx`：删除各自的 Topbar（由布局提供）
- [x] D5 `app/page.tsx`：卡片文案计数改为由 `getNationalDashboard()` 实际长度渲染（US-3 AC3）

## E. 测试与文档

- [x] E1 `macro-service.test.ts` 新增断言：国家经济数据 26 项且不含 industry 分组；行业观察 10 项；两页指标 key 无交集（AC-A）
- [x] E2 `docs/conventions.md`：术语表更新（删「数据观察」，加「宏观经济 / 二级菜单 / 行业观察 / 跟踪提醒」），新增「信息架构」小节
- [x] E3 `docs/README.md`：规格索引追加 008
- [x] E4 `docs/specs/001,002,003,005`：追加变更记录指向 008（SDD 一致性规则 1）

## F. 验证

- [x] F1 `npm test` 全绿（45 例，含 4 例新增分层断言）
- [x] F2 `next build` 通过（10 条路由全部生成）
- [x] F3 五页 `curl` 全 200（AC-C）
- [x] F4 实测确认: `/macro` 渲染「共 26 项指标」且无「行业景气与高频」区段；`/industry` 渲染「共 10 项指标」；三页二级菜单选中项分别为 国家经济数据 / 行业观察 / 跟踪提醒；侧边栏为 工作台 / 宏观经济 / 设置 三项

## 变更记录

- 2026-09-22: 初版落地。起因: 用户反馈「行业观察菜单单独列出来了？好像在国家经济数据里也有」—— 核查确认 `/macro` 确实重复渲染了 `industry` 分组，且侧边栏三项平铺缺乏层级。
- 2026-09-22: 验证阶段实测数据 —— `/macro` 26 项、`/industry` 10 项、两页并集 36 项 = 数据库指标总数，重复渲染问题消除；新建 4 例分层断言后 `npm test` 由 41 例增至 45 例。
- 2026-09-22: 页面目检顺带发现并修复一个独立瑕疵 —— 指标卡数值直接字符串化，出现「4.67675378%」；`formatValue` 的 <10000 分支收敛到 2 位小数并去尾零（commit 0f125ec，非本 spec 范围，就近修复）。
