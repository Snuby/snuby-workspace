# Spec 016 — 设计（design）

> 本设计在决策点 D1–D7 批复后定稿；未批复项标注「候选 A/B」并默认采用推荐值。

## 1. 导航结构

### 1.1 侧边栏（`src/components/workbench/sidebar.tsx`）
- `NAV` 数组由 5 项扩为 8 项（决策点 D6 候选 A 顺序）：

```
工作台 / 宏观经济 / 资产行情 / AI 模型榜单 / IT 资讯 / 自媒体 / Web 访问 / 设置
```

- 新增三个 `NavLeaf`，各带 `match` 路径数组（同 spec 008 决策 6 的一对多激活）：
  - IT 资讯：`/it-news`（若 D2 选 B 则含二级路径）
  - 自媒体：`/creators`、`/creators/xiaohongshu`、`/creators/wechat`
  - Web 访问：`/browser`
- 新增三个 17px 线性 SVG 图标（与现有 ICONS 同风格）：news（报纸）、creator（笔+面板）、browser（地球+地址栏）。

### 1.2 路由组（与 (macro)/(market)/(leaderboard) 同构，spec 008 决策 1/7）
- `src/app/(news)/layout.tsx` → IT 资讯外壳（Topbar「IT 资讯」+ 内容容器）；**单路由** `/it-news`，媒体切换为客户端状态（见 §2.2），不随媒体数量膨胀路由
- `src/app/(creators)/layout.tsx` → 自媒体外壳（Topbar + SectionTabs 二级菜单两页：小红书创作中心 / 微信公众号后台）
- `src/app/(browser)/layout.tsx` → Web 访问外壳（Topbar + 地址栏 + 内容容器）
- 二级菜单复用 `SectionTabs`（自媒体两页为静态路由级 tab，沿用现有组件）。

### 1.3 首页（`src/app/page.tsx`）
- 决策点 D7：新增三张卡片（IT 资讯 / 自媒体 / Web 访问），卡片风格与现有五张一致（图标块 + 标签 + 标题 + 描述 + 进入模块）。
- 首段简介「左侧四个板块」→「左侧七个板块」文案同步更新。

## 2. 组件设计

### 2.1 webview 容器复用与扩展
- `webview-frame.tsx` 现有能力：Electron UA 检测（SSR 首帧渲染 fallback → mount 后切 webview，防 React #418）、静态 `src`、`title`、`fallback`。
- **自媒体**：两页均复用 `webview-frame`，`src` = 创作中心/公众号后台官网。登录二维码在 webview 内展示。
- **Web 访问**：`webview-frame` 只支持静态 src，无法前进/后退/动态改址 → 新增 `src/components/browser/webview-browser.tsx`：
  - 顶部地址栏：URL 输入框 + 前往 + 后退 + 前进 + 刷新 + 主页按钮
  - 通过 `ref` 拿到 `<webview>` DOM 节点，调用 `loadURL / goBack / goForward / reload / stop`（Electron webview 原生方法）
  - URL 归一化：无协议补 `https://`；空输入回默认主页；输入即导航（回车触发）
  - 当前 URL 回显到地址栏（`did-navigate` / `did-navigate-in-page` 事件监听）
  - **默认主页（D4 定案）**：Google `https://www.google.com`
  - SSR 约束同 webview-frame：首帧渲染地址栏 + 空内容（或 fallback），mount 后创建 webview
- 通用：三模块的 webview 均保持 `webviewTag: true`、权限全拒（main.js 现状，无需改动）。

### 2.2 IT 资讯：客户端选项卡 + 动态添加（D2 定案，2026-09-23）
- **为什么客户端 tab 而非路由 tab**：榜单的 SectionTabs 是 `next/link` 路由级 tab，固定集合适用；媒体集合由用户动态增删，路由会随媒体数量无限膨胀且删除要处理路由 → IT 资讯用**单路由 `/it-news` + 客户端状态切换**，视觉效果与榜单完全一致（横向标签 + 激活下划线），切换媒体 = 切换 webview 的 `src`，不产生新 URL。
- **新组件 `src/components/news/it-media-tabs.tsx`**（视觉仿 SectionTabs，但为客户端状态版）：
  - 选项卡列表 = 内置默认集 + 自定义集（合并渲染，内置在前）
  - 点击 tab → 设置 `activeSlug` → 内容区 webview 切换 `src`
  - 右侧「＋ 添加」按钮（SectionTabs 同款右侧 action 位）→ 弹窗输入 **名称 + 网址** → 校验（名称非空、URL 补 `https://` 后合法）→ 加入自定义集并持久化 → tab 即时出现并自动激活
  - 自定义媒体 tab 提供删除（hover 显示 × 或管理入口）；内置集固定不可删（保持默认体验）
- **数据源与持久化**：
  - 内置默认集：`src/domain/it-media.ts` 静态常量（D1 定案 7 家：slug/名称/官网/简介/语种）
  - 自定义集：**localStorage**（key `snuby:it-media:custom`，JSON 数组）——Electron 渲染进程的 localStorage 持久化在 userData 下（`snuby-workspace`），Web 版同样生效，**一套代码两端一致，无需 IPC**（相较 014 白名单的 userData JSON + IPC 方案更轻）
  - 启动合并：内置 + `JSON.parse(localStorage)` 容错合并（损坏/缺失时仅内置集，不阻塞）
- **Web 版（FR-5）**：同一 `it-media-tabs` 组件渲染；内容区在非 Electron 下用 iframe 尽力渲染（复用榜单 AA 的 iframe 模式），iframe 被 XFO/CSP 拒绝时页面提供「在新窗口打开」外链按钮。

### 2.2 自媒体登录态（决策点 D3）
- 候选 A（推荐）：webview 加 `partition="persist:snuby-creators"`，登录 cookie 持久化到 `~/Library/Application Support/snuby-workspace/Partitions/snuby-creators`，重启保留。
- 候选 B：不设 partition，登录态随窗口 session 丢弃，每次重新扫码。
- 风险注记：小红书创作中心对非标准浏览器环境可能有风控（UA 检测/验证码升级）；微信公众号后台为标准扫码登录，风险低。若实测被拦，降级策略 = 该入口改为新窗口外链（`window.open` 已 allow），并在页面标注。

## 3. 降级矩阵（决策点 D5 定案）

| 模块 | 桌面版（Electron） | Web 版（浏览器） |
|---|---|---|
| IT 资讯 | 选项卡 + webview 内嵌媒体官网 | 选项卡照常；iframe 尽力渲染，XFO/CSP 拒绝时提供「在新窗口打开」外链按钮 |
| 自媒体 | webview 内嵌（持久 session） | 外链按钮（登录页无内嵌价值） |
| Web 访问 | 地址栏 + webview 完整浏览器 | 侧边栏隐藏入口；直连 `/browser` 显示「请使用桌面版」提示页 |

> 复用 `isElectron()`（`webview-frame.tsx` 内已有）做 UA 分支；选项卡/地址栏在 Web 版同样渲染，仅内嵌行为不同。

## 4. 数据与持久化

- IT 媒体：内置集 `src/domain/it-media.ts` 静态常量 + 自定义集 `localStorage["snuby:it-media:custom"]`（D2 定案；Electron 下 localStorage 落 userData，无需 IPC）。
- 自媒体 session：`partition="persist:snuby-creators"`（D3 定案）。
- Web 访问：无本地数据（不存历史记录，保持简单；如需「最近访问」列为后续增强项）。

## 5. 测试计划

- `it-media.ts`：内置集完整性（slug 唯一、URL 合法、字段齐全）。
- 自定义集合并逻辑（纯函数 `mergeMedia(builtin, custom)`）：去重、容错（JSON 损坏降级仅内置集）。
- URL 归一化（纯函数 `normalizeUrl`）：无协议补 https、空串、已带协议。
- NAV 激活：三个新入口的 match 路径（沿用 sidebar 现有测试模式）。
- 回归：106 例全绿 + `npm run build`。
- GUI 目检：开发壳 + 打包版——IT 资讯选项卡切换/添加/删除/重启持久化、自媒体登录二维码渲染、Web 访问地址栏导航/前进后退。
