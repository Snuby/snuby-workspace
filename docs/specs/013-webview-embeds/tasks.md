# Spec 013 — 任务

## A. 基础

- [x] A1 spec 四件套（本目录）
- [x] A2 从 feat/012 检出分支 `feat/013-webview-embeds`

## B. 可行性探测

- [x] B1 main.js 临时开 `webviewTag: true`
- [x] B2 OR 页临时渲染 `<webview src="https://openrouter.ai/rankings">`
- [x] B3 开发壳启动：目检 OR 图表/榜单非空，确认 clerk 正常（数据请求可达）

## C. 实现

- [x] C1 `src/components/leaderboard/webview-frame.tsx`（Electron 检测 + webview + fallback + JSX 类型声明）
- [x] C2 AA 页 / OR 页接入 WebviewFrame（Web 版降级保留）
- [x] C3 main.js：webviewTag + 导航白名单（will-navigate / window.open deny）+ webview 权限全拒

## D. 验证与收尾

- [x] D1 开发壳：两页 webview 渲染、resize 自适应、切页显示/隐藏、白名单拦截
- [x] D2 Web 版（npm start）：两页降级回归（AA iframe / OR 自渲染）
- [x] D3 `npm test` 全绿 + `npm run build` 通过
- [x] D4 `npm run dist` 打包版复检两页
- [x] D5 文档收尾（spec 状态 done、docs/README 索引）+ git 提交（不含他人文件）
