# 008 — macro-hierarchy（宏观经济层级收敛）

状态: **done**

## 目标

把侧边栏平铺的「数据观察 → 国家经济数据 / 行业观察 / 跟踪提醒」三项收敛为**单一一级菜单「宏观经济」**，进入后由**顶部二级菜单（Tab）**在三个子模块间切换，使层级关系在 UI 上一眼可辨。

同时修复收敛过程中暴露的两处缺陷：

1. **指标重复渲染**：`/macro`（国家经济数据）此前渲染了全部 9 个分组，其中包含 `industry` 分组 —— 10 项行业指标同时出现在「国家经济数据」和「行业观察」两页。收敛后 `/macro` 只保留 8 个宏观分组（26 项），行业 10 项仅归 `/industry`。
2. **首页卡片计数失准**：卡片文案写「26 项核心指标」，但实际页面渲染 36 项。修复后文案与页面一致。

## 非目标

- 不改动任何指标的抓取口径、数据源与时效判定逻辑（spec 004/005 不变）。
- 不改动告警规则表与判定逻辑（spec 002 不变）。
- 不引入多级菜单的数据结构抽象（当前只有一层嵌套，YAGNI）；侧边栏结构与二级菜单均在单一组件内常量定义。
- 不改 URL：三页路径保持 `/macro`、`/industry`、`/alerts`（见 design.md 决策 1）。

## 依赖

- 前置: spec 001（工作台外壳）、002（跟踪提醒）、003（手动更新）、004（时效性）、005（行业观察）。
- 本 spec 修订了 001/002/005 中关于侧边栏结构的描述，修订记录见各 spec 的「变更记录」小节。

## 交付物

- `src/app/(macro)/layout.tsx` — 路由组共享布局（Topbar + 二级菜单 + 滚动容器）
- `src/components/workbench/section-tabs.tsx` — 二级菜单组件
- `src/components/workbench/sidebar.tsx` — 收敛为单项「宏观经济」
- `src/application/macro-service.ts` — 新增 `getNationalDashboard()`
- 三个子页迁入路由组并移除各自重复的 Topbar / 滚动容器
- `src/application/macro-service.test.ts` — 新增分层断言
