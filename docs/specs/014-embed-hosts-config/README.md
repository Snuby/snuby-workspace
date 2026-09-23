# Spec 014 — 内嵌 Webview 导航白名单配置化

> ⚠️ **已废弃（spec 015）**：用户决定取消整套白名单机制，内嵌 webview 默认放行所有导航（提交 `294f8b7`）。白名单代码（embed-hosts.js / preload.js / embed-hosts-panel.tsx）已删除，设置页不再含白名单面板。本目录保留作为历史与审计记录。

## 背景

013 为桌面版内嵌 webview（OpenRouter / Artificial Analysis）设置了固定白名单（仅两榜域名）+ 弹窗 deny。用户实测发现 **Google / GitHub 授权登录跑不了**（OAuth 需要导航到 accounts.google.com / github.com，被白名单拦截）。用户要求：白名单进「设置」页，支持 `*.google.com` 通配，增删即时生效并持久化。

## 交付

- 设置页新增「内嵌 Webview 白名单」面板：内置 4 条（`*.openrouter.ai` / `*.artificialanalysis.ai` / `accounts.google.com` / `github.com`）+ 用户自定义条目管理。
- 通配语法：`*.domain` = 本域 + 全部子域；`domain` = 仅本域。增删即时生效，持久化 `userData/embed-hosts.json`。
- OAuth 修复：内置 OAuth 域 + 弹窗 allow（弹窗内导航仍受白名单约束），OR 页 Google 授权登录链路已实测放行。

## 关键文件

- `electron/embed-hosts.js`（解析模块）、`electron/preload.js`（桥）、`electron/main.js`（动态白名单 + IPC + 持久化）
- `src/components/settings/embed-hosts-panel.tsx`、`src/app/settings/page.tsx`

## 验证摘要

- 14 项解析自检 + 106 tests + build 全绿
- 开发壳/打包版 GUI：面板渲染、添加/删除即时生效并落盘、重启持久化、CC BY 外链热生效放行（013 拦截点反转）、Google OAuth 授权页渲染
- 提交 `585f951`；产物 `dist/Snuby 工作台-0.1.0-arm64.dmg` / `-mac.zip`

详见同目录 `requirements.md` / `design.md` / `tasks.md` / `verification.md`。
