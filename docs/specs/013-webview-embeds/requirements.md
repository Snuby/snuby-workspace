# Spec 013 — 需求

## 用户故事

- US-1：作为桌面版用户，我希望「AI 模型榜单」的两个榜单（Artificial Analysis / OpenRouter）以**官网原页**内嵌展示（Electron webview），交互、滚动、数据与官网一致。
- US-2：作为 Web 版用户，我希望榜单功能不受影响：AA 保持 iframe 直嵌、OR 保持官方 API 自渲染（降级路径）。
- US-3：作为用户，我希望内嵌的第三方站点被安全边界约束：不能导航到白名单域名之外，不能弹新窗口，不能申请系统权限。

## 验收标准

### AC-A 桌面版 webview 渲染
- 启动开发壳（`electron .`）与打包版：`/ai-leaderboard`（AA）与 `/ai-leaderboard/openrouter`（OR）均以 `<webview>` 渲染官网原页。
- OR 页面动态数据正常：排名图表/榜单非空（clerk 认证在 webview 顶层导航下正常工作，2026-09-23 若探测通过）。
- webview 区域铺满右侧内容区，随窗口 resize 自适应，页面切换显示/隐藏正常。

### AC-B Web 版降级不变
- `npm start` 打开 `http://localhost:3300/ai-leaderboard`：AA 仍为 iframe 直嵌。
- `/ai-leaderboard/openrouter`：仍为服务端 API 自渲染（Top 15 图 + Top 50 表），与 spec 011 行为一致。

### AC-C 安全边界
- 主进程对 webview 内容设置：`will-navigate` 仅放行 `.openrouter.ai` / `.artificialanalysis.ai`（含子域），其余一律 `preventDefault`。
- `window.open` 一律拒绝（`setWindowOpenHandler → deny`）。
- webview 的权限请求（摄像头/定位/通知等）一律拒绝；主页面不受影响。

### AC-D 回归与稳定性
- `npm test` 106 例全绿；`npm run build` 通过。
- 退出应用无残留进程（沿用 spec 012 机制）；Web 版不受影响（src 改动仅限榜单组件与 main.js）。

## 范围（非目标）

- 不做 OR/AA 的本地数据镜像或缓存（webview 直连官网）。
- 不迁移 spec 011 的 OR 自渲染实现（保留为 Web 版降级）。
- 不做 Windows/Linux（沿用 spec 012 范围）。
