# Spec 014 — 内嵌 Webview 导航白名单配置化

## 用户故事

- US-1：作为桌面版用户，我在内嵌榜单页（OpenRouter / Artificial Analysis）点击「Sign in with Google / GitHub」等第三方 OAuth 授权入口时，授权流程应能正常打开（此前被 013 白名单拦截，表现为"授权登录跑不了"）。
- US-2：作为桌面版用户，我希望在「设置」页能**自助管理**内嵌 webview 可导航的域名白名单：新增、删除、即时生效并持久化，重启后仍保留。
- US-3：作为用户，我期望配置支持**通配符**（如 `*.google.com` 表示 google.com 及其全部子域），并明确"不带 `*.` 仅匹配该域名本身"的语义。

## 验收标准

### AC-A OAuth 授权链路放行
- 内置默认白名单包含 OAuth 所需域：`accounts.google.com`（Google 授权页）、`github.com`（GitHub 授权页），回调域 `*.openrouter.ai` / `*.artificialanalysis.ai` 已在 013 内置。
- 桌面版 OR 页点 Sign Up → Sign in with Google → 能进入 `accounts.google.com` 登录页（完整渲染，redirect_uri 指向 `clerk.openrouter.ai/v1/oauth_callback`，回调域在白名单内可闭环）。
- `setWindowOpenHandler` 对 webview 弹窗允许打开（弹窗内导航仍受 will-navigate 白名单约束）。

### AC-B 设置页配置面板
- 「设置」页新增「内嵌 Webview 白名单」面板：展示内置条目（带「内置」标记）与自定义条目（带「删除」按钮）、输入框（占位 `添加域名，如 *.google.com`）与「添加」按钮。
- 添加成功提示「已保存，立即生效（N 条自定义）」；非法输入（非域名、含 `http://`、空、无点）明确报错并列出无效条目原文，不写入。
- 删除立即生效并持久化；重启后自定义条目仍在。
- Web 版（非 Electron）显示「仅桌面版可用」降级占位，不渲染面板。

### AC-C 通配与匹配语义
- `*.google.com`：命中 google.com 及其全部子域（含深层子域）；**不**命中 `google.com.evil.com`、`evilgoogle.com`。
- `google.com`（不带 `*.`）：仅命中 google.com 本域，不命中子域。
- 大小写归一、尾随点去除；内置集与自定义集合并去重后统一判定。

### AC-D 持久化与安全
- 持久化文件：`userData/embed-hosts.json`（开发壳 `snuby-workspace`，打包版同路径）。
- 非法条目在写入前被过滤（sanitize）；主进程仍为唯一判定入口（`will-navigate` preventDefault），preload 仅暴露 `get/set` 两个只读/受控 IPC。
