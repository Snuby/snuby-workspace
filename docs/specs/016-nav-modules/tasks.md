# Spec 016 — 任务（tasks）

> 状态：**决策点已全部定案（2026-09-23 批复），待用户确认最终方案后开工编码**。
> 决策定案：D1 内置 7 家推荐集 / D2 选项卡+客户端状态+动态添加 / D3 自媒体 session 持久化 / D4 默认主页 Google / D5 降级矩阵 / D6 侧边栏位置 / D7 首页卡片。

## T1 ✅ 榜单页顶条移除（已完成，提交 `d6ef31d`）
- 去掉 `webview-frame.tsx` 顶条（提示行 + 「在新窗口打开」链接），webview 直接占满。
- 桌面版/Web 版共用组件，一处改动双端生效。
- `npm run build` 通过、106 测试全绿。

## T2 ⏳ IT 资讯：内置媒体集与选项卡（D1/D2 定案）
- [ ] `src/domain/it-media.ts`：内置 7 家（The Verge / Ars Technica / MIT Tech Review / 量子位 / 新智元 / 机器之心 / InfoQ 中文）
- [ ] `src/components/news/it-media-tabs.tsx`：客户端选项卡（内置+自定义合并、点击切换、激活态视觉同款 SectionTabs）
- [ ] `mergeMedia` 纯函数 + localStorage 读写（`snuby:it-media:custom`，容错解析）
- [ ] `src/app/(news)/` 路由组（单路由 `/it-news`），内容区桌面 webview / Web iframe+外链（复用 `isElectron` 分支）

## T3 ⏳ IT 资讯：动态添加/删除
- [ ] 「＋ 添加」入口（SectionTabs 同款右侧 action 位）→ 弹窗（名称 + 网址）→ 校验 → 持久化 → tab 即时出现并激活
- [ ] 自定义媒体删除（hover × 或管理入口）；内置集固定不可删

## T4 ⏳ 自媒体：入口与登录态（D3 定案）
- [ ] `src/app/(creators)/` 路由组 + SectionTabs 两页（小红书创作中心 / 微信公众号后台）
- [ ] 两页复用 `webview-frame`，`partition="persist:snuby-creators"`
- [ ] Web 版：外链按钮

## T5 ⏳ Web 访问：简易浏览器（D4 定案）
- [ ] `src/components/browser/webview-browser.tsx`：地址栏（Google 默认主页）+ 前进/后退/刷新/主页 + webview（ref 原生方法）
- [ ] `normalizeUrl` 纯函数 + 测试
- [ ] `src/app/(browser)/` 路由组；Web 版隐藏入口 + 提示页

## T6 ⏳ 侧边栏与首页整合（D6/D7 定案）
- [ ] NAV 新增三项（IT 资讯 / 自媒体 / Web 访问）+ 三个线性 SVG 图标，位于 AI 模型榜单之后、设置之前
- [ ] 首页三张新卡片 + 「左侧七个板块」文案

## T7 ⏳ 测试与构建
- [ ] 新增单元测试（it-media / mergeMedia / normalizeUrl / NAV 激活）
- [ ] `npm run build` + 全量测试全绿

## T8 ⏳ GUI 验证与打包
- [ ] 开发壳目检：IT 资讯选项卡切换/添加/删除/刷新持久化、自媒体登录二维码、Web 访问导航/前进后退
- [ ] 打包版目检（冷启动、三模块、自媒体登录态重启保留）
- [ ] 构建 dmg/zip 并交付

## 风险与开放项
- 小红书创作中心 webview 风控（design §2.1 风险注记）——需实测，若被拦该入口降级外链。
- 微信公众平台登录需手机扫码，属用户手动步骤（桌面版内嵌展示二维码）。
- 内置媒体官网对 Web 版 iframe 的 XFO/CSP 兼容性（桌面 webview 不受限）；被拒项在 Web 版自动呈现外链按钮。
