# Spec 016 — 工作台导航扩展：IT 资讯 / 自媒体 / Web 访问

> 状态：**规划中（等用户批复决策点后再编码）**。编码分支：`feat/013-webview-embeds`。

## 用户需求（2026-09-23）

1. ✅ **已完成**：榜单页顶部去掉「内容跟随官方页面实时更新；交互与滚动在框架内进行。」提示行与「在新窗口打开 ↗」链接（顶条仅含这两元素，整条移除，webview 直接占满内容区）。提交 `d6ef31d`。
2. ⏳ **规划中**：左侧新增三个一级模块：
   - **IT 资讯**：收录权威专业 IT 媒体网站（候选清单见 requirements.md，待用户勾选）
   - **自媒体**：小红书创作中心、微信公众号后台
   - **Web 访问**：顶部自填 URL 的简易浏览器

用户明确要求第 2 项**先规划、不着急编码**。

## 待批复决策点（详见 requirements.md §4）

- D1 IT 资讯收录哪些媒体（中英文候选清单勾选）
- D2 IT 资讯交互形态（媒体列表页 vs 默认一家可切换）
- D3 自媒体登录态是否持久化（推荐持久化到 userData session）
- D4 Web 访问默认主页（空白页 / 必应等）
- D5 三个模块在 Web 版（非 Electron）的降级策略
- D6 侧边栏位置与图标
- D7 首页是否新增三张模块卡片

## 关键文件（规划涉及）

- `src/components/workbench/sidebar.tsx`（NAV 数组，当前 5 项）
- `src/app/page.tsx`（首页卡片 + 首段简介文案「左侧四个板块」）
- `src/components/leaderboard/webview-frame.tsx`（webview 容器，可复用/扩展）
- `src/components/workbench/section-tabs.tsx`（二级菜单）
- `electron/main.js`（webviewTag 已开、默认放行所有导航、window.open allow——013/015 定案）

详见同目录 `requirements.md` / `design.md` / `tasks.md`。
