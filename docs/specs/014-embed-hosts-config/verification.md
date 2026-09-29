# Spec 014 — 验证记录

验证日期：2026-09-23

## 单元自检（embed-hosts.js，node 直测，14 项全 PASS）

- `*.creativecommons.org` 命中本域与子域 `www.creativecommons.org`
- `*.google.com` 命中 `google.com` / `accounts.google.com` / `a.b.google.com`；不命中 `google.com.evil.com` / `evilgoogle.com`
- 精确条目 `github.com` 命中 `github.com`，不命中 `raw.github.com`
- 内置集命中：openrouter 子域、accounts.google.com、github.com；不命中 creativecommons（默认集）
- 非法条目拒绝：`http://x.com`、`x.com/path`、`x.com:8080`、`com`（无点）、空串、含空格
- `sanitizeList` 去重、invalid 原样返回

## 构建与测试

- `npm run build`：通过（全部路由编译成功）
- `npm test`：106 例全绿（Node --import tsx）

## 开发壳 GUI 实测（com.github.Electron）

| 项 | 结果 |
|---|---|
| 设置页白名单面板 | ✅ 4 条内置（*.openrouter.ai / *.artificialanalysis.ai / accounts.google.com / github.com 带「内置」）+ 说明文案 + 输入框 + 添加按钮 |
| 添加 `*.creativecommons.org` | ✅ 提示「已保存，立即生效（1 条自定义）」；`snuby-workspace/embed-hosts.json` = `["*.creativecommons.org"]` |
| 重启后持久化加载 | ✅ 重启后自定义条目仍在列表 |
| 热生效（013 验收点反转） | ✅ OR 页点击 CC BY 4.0 外链（creativecommons.org）→ webview 成功导航至 `creativecommons.org/licenses/by/4.0/` 完整渲染（013 时为拦截） |
| OAuth Google 授权 | ✅ OR 页 Sign Up → Sign in with Google → webview 进入 `accounts.google.com` 登录页（中文「使用 Google 账号登录」+ 邮箱输入框 + 下一步），redirect_uri 指向 `clerk.openrouter.ai/v1/oauth_callback`（回调域在内置白名单，可闭环） |
| 删除恢复 | ✅ 删除后「已保存，立即生效（0 条自定义）」，文件清空 `[]` |

## 打包版实测（com.snuby.workbench，0.1.0）

| 项 | 结果 |
|---|---|
| 冷启动 | ✅ 3310 HTTP 200（首页/设置）、FATAL 0；OR 页 Top Models 全量渲染（数据至 2026-09-22） |
| 设置面板 | ✅ 4 条内置 + 输入框 + 添加按钮完整渲染 |
| 添加/删除落盘 | ✅ 添加 `*.example.com` → `snuby-workspace/embed-hosts.json` = `["*.example.com"]`；删除 → `[]`（打包版 userData 与开发壳一致为 snuby-workspace） |
| 退出零残留 | ✅ 关闭后 3310 refused，无 next-server / Electron 残留进程 |

## 产物

- `dist/Snuby 工作台-0.1.0-arm64.dmg`（231360556 B）
- `dist/Snuby 工作台-0.1.0-arm64-mac.zip`（226902853 B）
- 提交：`585f951`（feat/013-webview-embeds 分支，spec 014）

## 已知边界

- OAuth 登录完成后的凭据输入与授权确认需用户操作（登录本身不自动化）；授权页渲染与回调域闭环已验证。
- Web 版（3300）本次未重启回归；白名单面板在 Web 版为「仅桌面版可用」占位（UA 检测 + bridge 存在性双条件），不影响 Web 版功能。
