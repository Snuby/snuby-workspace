# Spec 016 — 任务（tasks）

> 状态图：T1 已完成；T2–T8 依赖决策点 D1–D7 批复后开工（用户明确「先规划，不着急编码」）。

## T1 ✅ 榜单页顶条移除（已完成，提交 `d6ef31d`）
- 去掉 `webview-frame.tsx` 顶条（提示行 + 「在新窗口打开」链接），webview 直接占满。
- 桌面版/Web 版共用组件，一处改动双端生效。
- `npm run build` 通过、106 测试全绿。

## T2 ⏳ IT 资讯：媒体清单与路由（依赖 D1/D2/D6/D7）
- [ ] `src/domain/it-media.ts`：按批复清单收录媒体（slug/名称/官网/简介/语种）
- [ ] `src/app/(news)/` 路由组：列表页（D2-A）或默认页+切换（D2-B）
- [ ] 侧边栏 NAV 新增「IT 资讯」+ 图标
- [ ] 首页卡片（D7-A）

## T3 ⏳ IT 资讯：webview 详情页（依赖 D2）
- [ ] `/it-news/[slug]` 详情页复用 `webview-frame`（桌面 webview / Web 降级）

## T4 ⏳ 自媒体：入口与登录态（依赖 D3/D6/D7）
- [ ] `src/app/(creators)/` 路由组 + SectionTabs 两页（小红书创作中心 / 微信公众号后台）
- [ ] 两页复用 `webview-frame`，`partition="persist:snuby-creators"`（D3-A）
- [ ] 侧边栏 NAV 新增「自媒体」+ 图标；首页卡片（D7-A）

## T5 ⏳ Web 访问：简易浏览器（依赖 D4/D6/D7）
- [ ] `src/components/browser/webview-browser.tsx`：地址栏 + 前进/后退/刷新/主页 + webview（ref 调用原生方法）
- [ ] `normalizeUrl` 纯函数 + 测试
- [ ] `src/app/(browser)/` 路由组；侧边栏 NAV 新增「Web 访问」+ 图标；首页卡片（D7-A）
- [ ] Web 版：隐藏入口 + 提示页（D5-A）

## T6 ⏳ 首页文案与侧边栏整合
- [ ] 首页「左侧四个板块」→「左侧七个板块」文案
- [ ] NAV 顺序定稿（D6）

## T7 ⏳ 测试与构建
- [ ] 新增单元测试（it-media / normalizeUrl / NAV 激活）
- [ ] `npm run build` + 全量测试全绿

## T8 ⏳ GUI 验证与打包
- [ ] 开发壳目检：IT 资讯列表→打开媒体、自媒体登录二维码、Web 访问导航/前进后退
- [ ] 打包版目检（冷启动、三模块、登录态持久化验证）
- [ ] 构建 dmg/zip 并交付

## 风险与开放项
- 小红书创作中心 webview 风控（见 design §2.2 风险注记）——需实测，若被拦降级外链。
- 微信公众平台登录需手机扫码，属用户手动步骤（桌面版内嵌展示二维码）。
- IT 资讯媒体官网的 XFO/CSP 对 Web 版 iframe 的影响（桌面版 webview 不受限）。
