# Spec 014 — 任务

| # | 任务 | 状态 | 说明 |
|---|---|---|---|
| 1 | 新增 `electron/embed-hosts.js` 白名单解析模块 | done | normalizeEntry / isHostAllowed / sanitizeList，14 项自检全 PASS |
| 2 | 新增 `electron/preload.js` 桥 | done | contextBridge 暴露 `snubyEmbedHosts.get/set`，仅两个 IPC |
| 3 | 改造 `electron/main.js` 动态白名单 + IPC + 持久化 | done | DEFAULT+user 合并判定；`embed-hosts:get/set`；userData/embed-hosts.json 读写；whenReady 加载；webPreferences.preload |
| 4 | OAuth 放行 | done | 内置 accounts.google.com/github.com；setWindowOpenHandler allow |
| 5 | 新增 `src/components/settings/embed-hosts-panel.tsx` | done | 内置/自定义列表 + 删除 + 输入框 + 添加 + 成功/失败提示；Web 版占位 |
| 6 | 设置页接入面板 | done | `src/app/settings/page.tsx` 插入 `<EmbedHostsPanel />` |
| 7 | 构建 + 测试 | done | `npm run build` 通过；`npm test` 106 例全绿 |
| 8 | 开发壳 GUI 实测 | done | 面板渲染 / 添加 / 重启持久化 / CC BY 外链放行 / OAuth Google 登录页 / 删除清理 |
| 9 | 重新打包 + 打包版实测 | done | dmg/zip 重建；冷启动 3310 就绪、FATAL 0；面板 + 添加/删除落盘；退出零残留 |
| 10 | git 提交 | done | `585f951`（5 files，+240/-8） |
