# Spec 014 — 设计

## 架构决策

### 决策 1：白名单解析独立成模块（electron/embed-hosts.js）

与 main.js 解耦，纯函数、可单测。核心：

- `normalizeEntry(raw)` → `{ raw, base, wildcard }`：`*.` 前缀提取；域名正则 `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`（小写化后校验）；拒绝 `http://`、空格、端口、无点、空串。
- `isHostAllowed(host, entries)`：通配条目 = 本域 + 全部子域（`host === base || host.endsWith('.' + base)`）；精确条目 = 仅 `host === base`。大小写归一，尾随 `.` 去除。
- `sanitizeList(entries)` → `{ valid, invalid }`：逐条 normalize，去重，返回合法集与非法集原文。

### 决策 2：内置默认集 + 用户自定义集合并

- 内置：`["*.openrouter.ai", "*.artificialanalysis.ai", "accounts.google.com", "github.com"]`（013 的两榜域名升级为 `*.` 通配，覆盖未来子域变化；OAuth 域内置保证授权登录开箱可用）。
- 判定时 `combined = DEFAULT_EMBED_HOSTS + userEmbedHosts`（sanitize 后），命中任一即放行。
- 用户条目持久化 `userData/embed-hosts.json`，启动时加载（`loadUserEmbedHosts`），改动即写（`saveUserEmbedHosts`）。

### 决策 3：preload 最小桥 + IPC

- `electron/preload.js`：contextBridge 暴露 `window.snubyEmbedHosts = { get, set }`，仅两个 IPC 通道（`embed-hosts:get` 返回 `{builtin, custom}`；`embed-hosts:set` 先 sanitize，非法则返回 `{ok:false, invalid}`，合法则保存并返回 `{ok:true, builtin, custom}`）。
- 权限面最小：渲染进程拿不到 Node/主进程其他能力；白名单判定仍只在主进程 `will-navigate` 执行。

### 决策 4：OAuth 弹窗放行

- 013 的 `window.open deny` 改为 `setWindowOpenHandler(() => ({action: "allow"}))`：OAuth 授权常以弹窗（新 BrowserWindow）呈现；弹窗内导航仍受 `will-navigate` 白名单约束，配合内置 OAuth 域形成闭环（授权 → 回调回 openrouter.ai 在白名单内）。

### 决策 5：设置面板组件

- `src/components/settings/embed-hosts-panel.tsx`（client 组件）：UA 检测 Electron 且 `window.snubyEmbedHosts` 存在才渲染面板；Web 版显示「仅桌面版可用」占位行。
- 交互：内置条目只读带「内置」标；自定义条目带「删除」；输入框 Enter 或「添加」按钮提交；成功/失败提示（失败列出非法原文）；操作后经 `set` IPC 刷新列表。

## 数据流

```
设置面板(渲染进程) --ipc embed-hosts:set--> 主进程 sanitizeList
   ├─ 非法 → {ok:false, invalid:[...]} → 面板报错
   └─ 合法 → saveUserEmbedHosts(userData/embed-hosts.json)
           → combinedEmbedHosts 更新（内存即时生效）
webview will-navigate(任意导航) --主进程 isHostAllowed(combined)-->
   ├─ 命中 → 放行
   └─ 未命中 → event.preventDefault()（webview 停留原页）
启动时 loadUserEmbedHosts() → combined = DEFAULT + user → 首次渲染即含持久化条目
```

## 接口契约

| 项 | 值 |
|---|---|
| IPC 通道 | `embed-hosts:get` / `embed-hosts:set` |
| preload 暴露 | `window.snubyEmbedHosts.get() / set(entries)` |
| 持久化文件 | `userData/embed-hosts.json`（数组，仅自定义条目） |
| 通配语法 | `*.domain.tld` = 本域 + 全部子域；`domain.tld` = 仅本域 |
| 判定时机 | `web-contents-created` → `will-navigate`（webview 类型 contents）；`setWindowOpenHandler` allow |

## 验证路径

1. `node -e` 直测 embed-hosts.js：通配/精确/子域/深层子域/跨域伪装/非法条目/sanitize 去重（14 项自检）。
2. `npm run build` + `npm test`（106 例全绿）。
3. 开发壳 GUI：设置面板渲染 → 添加 `*.creativecommons.org` → 即时生效 + 落盘 → 重启加载 → OR 页点 CC BY 4.0 外链放行（013 时被拦）→ 删除恢复 → OAuth：Sign Up → Google 登录页渲染。
4. 打包版：冷启动 3310 就绪、FATAL 0 → 设置面板 → 添加/删除即时生效 + 落盘 → 退出零残留。
