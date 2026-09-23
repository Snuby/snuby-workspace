# Spec 013 — 设计

## 架构决策

### 决策 1：桌面版用 `<webview>` 嵌官网原站，Web 版保留现状

```
/ai-leaderboard (AA)         /ai-leaderboard/openrouter (OR)
  ├─ Electron: <webview src="artificialanalysis.ai">   ├─ Electron: <webview src="openrouter.ai/rankings">
  └─ Web: iframe 直嵌 (011 现状)                        └─ Web: 服务端 API 自渲染 (011 现状)
```

- 动机：OR 官网 `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'` 拒绝 iframe 嵌入，且 clerk 认证组件在 iframe 下挂起（011 实测）；`<webview>` 是独立 WebContents + 顶层导航语义，不受 XFO/CSP 限制，clerk 可正常激活（AC-A 探测验证）。
- `<webview>` vs `WebContentsView`（选型，2026-09-23 用户确认）：webview 是渲染进程 DOM 元素，显示/隐藏由路由组件声明式控制、布局由 CSS 自动管理、resize 由浏览器自动重排，**零主进程布局逻辑**；WebContentsView 需主进程手动 `setBounds` + 路由同步（IPC），对单页面工具维护成本过高。官方虽推荐 WebContentsView，本项目选 webview 属明确取舍。
- 降级路径：Web 版（普通浏览器）无 `<webview>` 元素，按 US-2 保留 011 现状；检测方式为客户端 `navigator.userAgent` 含 `"Electron"`。

### 决策 2：条件渲染组件

- 新增 `src/components/leaderboard/webview-frame.tsx`（`"use client"`）：
  - props: `{ src: string; title: string; fallback: ReactNode }`
  - 客户端检测 `isElectron()`：真 → 渲染 `<webview>`；假 → 渲染 `fallback`（调用方传入 011 现有实现）。
  - `<webview>` 非标准 HTML 元素：在组件内声明 JSX 类型（`declare global` + `JSX.IntrinsicElements`），避免 TS 报错；样式 `width/height: 100%`，父容器 flex-1。
- 页面改动：
  - `ai-leaderboard/page.tsx`：`<WebviewFrame src="https://artificialanalysis.ai/" fallback={<LeaderboardFrame .../>}>`。
  - `ai-leaderboard/openrouter/page.tsx`：保持服务端组件（沿用 force-dynamic fetch，Web 版数据路径不变）；渲染 `<WebviewFrame src="https://openrouter.ai/rankings" fallback={<OpenRouterBoard rows=... />}>`。桌面版会多一次无害的服务端 fetch（不落库），换取 Web 版零改动。
- `webview` 的 session：默认 partition（空串）→ 与主页面共享默认 session，OR clerk 登录态行为与正常浏览器一致；不做分区隔离（本项目无隔离需求）。

### 决策 3：主进程安全配置（main.js）

- `BrowserWindow.webPreferences.webviewTag: true`。
- 全局 `app.on("web-contents-created")` 对每个 webContents（含 webview 子内容）：
  - `setWindowOpenHandler(() => ({ action: "deny" }))`：拒绝一切弹窗（AC-C）。
  - `will-navigate`：目标 URL 域名白名单（`.openrouter.ai`、`.artificialanalysis.ai` 及裸域）外一律 `preventDefault`（AC-C）。
- `session.defaultSession.setPermissionRequestHandler((wc, _permission, cb) => cb(wc.getType() === "webview" ? false : true))`：webview 权限全拒，主页面默认放行（本项目主页面无需特殊权限，AC-C）。

## 数据流

```
桌面版: 用户点侧边栏「AI 模型榜单」
  → Next 路由渲染 WebviewFrame (Electron 检测命中)
  → <webview src=官网> → 主进程 spawn 的独立渲染进程加载官网 (顶层导航, 无 XFO/CSP 限制)
  → 官网动态数据 (OR clerk / AA 图表) 正常激活
  → 导航白名单 + 权限拦截在 did-attach 的 webContents 上生效
Web 版: 同一路由 → isElectron()=false → fallback (011 现状)
```

## 接口契约

- `webview-frame.tsx`：`{ src: string; title: string; fallback: ReactNode }`，无对外数据接口。
- main.js 新增：`webviewTag: true`；`web-contents-created` 白名单拦截（域名列表常量 `ALLOWED_EMBED_HOSTS`）；`setPermissionRequestHandler`。
- 不改动：OR 服务端 API 数据路径（`src/domain/or-rankings.ts`、`openrouter-board.tsx`）、AA iframe 组件（`leaderboard-frame.tsx`，作为 fallback 复用）、spec 001–012 任何契约。

## 验证路径

1. 探测（先于实现）：main.js 临时开 `webviewTag`，OR 页临时渲染 `<webview src="https://openrouter.ai/rankings">`，开发壳启动后目检图表非空 + 确认数据请求（AC-A 前置）。
2. 实现后：开发壳两页目检（webview 渲染、resize 自适应、切页显示/隐藏）；Web 版 `npm start` 两页回归（AC-B）。
3. 安全：开发壳内尝试 webview 导航到白名单外 URL，确认被拦截（AC-C）。
4. `npm test` + `npm run build`（AC-D）；`npm run dist` 打包版复检（AC-A）。

### 决策 4：hydration 策略（实施补充）

服务端无法感知 Electron（UA 在客户端），若 SSR 直接渲染 webview 而客户端也渲染 webview，首屏 HTML 与客户端一致但 SSR 无法产出 webview 内容；若 SSR 渲染 fallback、客户端立即渲染 webview，则触发 React #418 hydration 失败（实测：整树卸载、白屏、webview 不创建）。最终方案：**初始（SSR + 客户端首帧）一律渲染 fallback，mount 后 `useEffect` 检测 Electron 再切换 webview**。副作用：Electron 下首帧短暂显示 fallback（OR 自渲染榜单）后替换为官网原页，可接受。

### 决策 5：启动时序（实施补充）

next start 打印 Ready 后首个 HTTP 请求仍可能未就绪（冷启动时序），打包版实测出现 `ERR_EMPTY_RESPONSE` / `ERR_CONNECTION_REFUSED`。修复：① `startNextServer` 在 Ready 日志后对端口做 TCP 可达性轮询（最长 20s）再 resolve；② `loadURL` 带重试（12 次 × 2s）。验证：全新启动 10s 内首页 200，FATAL 0。
