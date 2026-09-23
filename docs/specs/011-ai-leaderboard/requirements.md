# 011 — 需求

## 用户故事

- **US-1**: 作为工作台用户，我想在左侧菜单看到一个「AI 模型榜单」板块，点进去看到 Artificial Analysis 的榜单页，以便随时查看权威模型排名。
- **US-2**: 作为工作台用户，我想在板块内切换到 OpenRouter Rankings，以便查看按真实 token 用量排名的生态榜。
- **US-3**: 作为工作台用户，我想榜单内容跟随官方页面实时更新，而不是本地缓存的过期数据。
- **US-4**: 作为工作台用户，我想 iframe 内页面能正常滚动/交互，与直接访问官网一致。

## 验收标准

### AC-A 板块入口
- 侧边栏出现「AI 模型榜单」一级菜单，点击进入 `/ai-leaderboard`，菜单高亮正确。
- 首页出现「AI 模型榜单」模块卡片，可点击进入板块。

### AC-B 默认页（Artificial Analysis）
- `/ai-leaderboard` 右侧内容区渲染 `https://artificialanalysis.ai/` 的 iframe。
- iframe 实际加载出官方页面内容（浏览器目检确认，非空白/错误页）。
- 页面上方有来源说明与「在新窗口打开」外链。

### AC-C OpenRouter 子页（用户批复：自渲染方案）
- `/ai-leaderboard/openrouter` 页面通过官方公开 API 自渲染榜单：Top 15 横向柱状图 + Top 50 表格（排名/模型/周 tokens），数据截至日期正确显示（浏览器目检）。
- 数据跟随官方 API 实时（`cache: no-store`，每次刷新重取），与官方页面口径一致（tokens = completion + prompt）。
- 页面上方有「打开官方页面」直链；fetch 失败时显示错误态 + 官方直链，页面不崩溃。

### AC-D 聚合正确性
- `npm test` 含 `or-rankings` 单测：同 slug 多行求和、降序赋 rank、updatedAt 取最大日期、`shortModelName` 去日期/去厂商前缀、`formatTokens` T/B/M 边界（spec 006）。
- 服务端 fetch 带浏览器 UA/referer；上游 5xx/网络错误 → 页面错误态（非 200 空壳）。

### AC-E 既有板块不受影响
- `npm test` 全绿（原 100 例不变）、`next build` 通过、首页/既有板块页面 200。

## 非目标

- 不本地存储榜单数据、不做历史对比。
- 不做 OpenRouter 登录态代管。
