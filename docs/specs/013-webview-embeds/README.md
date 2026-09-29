# Spec 013 — AI 模型榜单 webview 内嵌（Snuby 工作台桌面版）

状态：done

## 目标

把「AI 模型榜单」板块（spec 011）在**桌面版**（Electron）中改为 `<webview>` 内嵌官网原站：Artificial Analysis 与 OpenRouter 排名页均以官网原貌展示（完整交互与动态数据）；**Web 版保持 011 现状**（AA iframe 直嵌 / OR 官方 API 自渲染）作为降级。

## 核心决策（详见 design.md）

1. **webview 而非 WebContentsView**（用户 2026-09-23 确认）：webview 是渲染进程 DOM 元素，显示/隐藏、布局、resize 全部声明式自动管理；WebContentsView 需主进程手动像素对齐 + 路由同步，维护成本高。webview 以顶层导航语义加载第三方站点，不受 XFO/CSP 限制（OR 官网因此可嵌入），clerk 认证可正常激活。
2. **条件渲染**：新增 `webview-frame.tsx` 客户端组件，按 `navigator.userAgent` 含 Electron 分流：桌面 → `<webview src=官网>`；Web → fallback（011 现有实现）。
3. **安全边界**：主进程开 `webviewTag`，对 webview 子内容做导航白名单（仅 `.openrouter.ai` / `.artificialanalysis.ai`）、拒绝 `window.open`、拒绝权限请求。
4. **零契约改动**：OR 服务端 fetch 路径、AA iframe 组件均保留（作降级），spec 001–012 不受影响。

## 非目标

- 不做官网数据的本地镜像/缓存（webview 直连）。
- 不迁移/删除 011 的 OR API 自渲染（Web 版降级必需）。
- 不做 Windows/Linux（沿用 spec 012 范围）。

## 交付物

- `src/components/leaderboard/webview-frame.tsx` — 条件渲染组件（Electron → webview，Web → fallback）
- `src/app/(leaderboard)/ai-leaderboard/page.tsx`、`.../openrouter/page.tsx` — 接入 WebviewFrame
- `electron/main.js` — webviewTag + 导航/权限安全配置
- `docs/specs/013-webview-embeds/` 四件套
- 探测记录：OR clerk 在 webview 下的实测结论

## 变更记录

- 2026-09-23: 初版（implementing）；同日本轮实现完成：hydration 策略（SSR fallback → mount 后切 webview，防 React #418）、导航白名单拦截、权限全拒、loadURL 时序重试；开发壳/打包版两页 webview 渲染目检通过（clerk 正常、动态数据全量激活），Web 版降级回归通过，106 测试全绿，标记 done。
