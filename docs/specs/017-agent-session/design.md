# Spec 017 — 设计（AgentSession 对象化架构）

## 1. 聚合根：AgentSession

同一 `sessionId`（`data/agent-sessions/<id>` 的目录名）贯穿三层，是会话的唯一标识与关联键。

```
AgentSession（聚合根, sessionId 贯穿三层）
├── Identity     meta.json：id / title / createdAt / updatedAt / acpSessionId / acpCwd / model / sysPromptFp
├── UiState      （前端内存）AgentSessionUi：msgs / cursor / hasMore / loaded / loading / lastUsed
├── Workspace    （磁盘）agent-workspaces/<id>/：cwd 指向 + artifacts/（唯一授权写区）
├── GatewayState （服务端）AgentSessionService：连接 + 网关会话 + 配置缓存 + 队列 + running
└── RunState     （前端内存）runsRef：每个会话最多一个并行任务（msgId/text/tools/ac）
```

### 命名族（三层对称）

| 概念 | 前端 | 服务端 | 磁盘 |
|---|---|---|---|
| 会话视图/网关态 | `AgentSessionUi`（uiRef 缓存） | `AgentSessionService`（ConnState 语义别名） | `AgentSessionRepository`（store） |
| 注册表 | `uiRef` Map + `gwRef` Map | `conns` Map（Registry 别名） | `SESSIONS_ROOT` / `WORKSPACES_PATH` 目录 |

## 2. 四层防串矩阵

| 层 | 机制 | 状态 |
|---|---|---|
| 渲染 | 单指针 currentIdRef + 代际守卫 loadSeqRef + commitMsgs/commitPage 按 sessionId 落缓存、仅激活会话 setMsgs | ✅ 本轮实现 |
| 网关 | per-session 连接（key=localSessionId）+ per-session cwd + 连接级错误重建 | ✅ 既有（spec 017 前） |
| 文件 | `workspaces/<id>` 物理分离 + 注入约定强约束 + 任务后越界审计 + UI 警告 | ✅ 本轮软隔离；硬隔离（delegateToolsSupport + realpath 白名单）待验证 |
| API | 路由一律以 `localSessionId` 定位连接/会话；`status?sid=` 返回会话自己的网关态 | ✅ 既有 + 本轮 |

## 3. 存储布局（AgentSessionRepository）

```
data/
├── agent-sessions/                     # 内部数据（WorkBuddy 不可见、不可写）
│   ├── <session-id>/meta.json          # Identity
│   ├── <session-id>/messages.jsonl     # 历史对话（每行一条 JSON）
│   ├── system-prompt.txt               # 全局工作约定（所有会话注入）
│   └── model-preference.json           # 模型偏好（新会话恢复）
└── agent-workspaces/                   # 授权工作区（网关 cwd 指向这里）
    └── <session-id>/artifacts/         # 任务产物（必须写在这里）
```

- 环境覆盖：`AGENT_SESSIONS_PATH` / `AGENT_WORKSPACES_PATH`。
- `migrateWorkspaces()`：一次性、幂等、惰性（listSessions/getSession/createSession 首触），把旧 `sessions/<id>/artifacts` 迁入 `workspaces/<id>/artifacts` 并把 `meta.acpCwd` 对齐到新工作区。
- `auditWorkspaceViolations(id, {cutoffMs})`：扫描本会话目录之外的所有会话目录，返回 cutoff 窗口内有新写入的文件清单（软隔离兜底证据）。
- `deleteSession` 同时清理 sessions 与 workspaces 两处。

## 4. 激活与注入（activateLocalSession）

- `cwd = meta.acpCwd ?? workDirOf(id)`，网关 cwd 恒指向工作区。
- 注入文本 `buildSessionSetupText(sysPrompt, workDir, dataDir)`：
  - 工作目录/产物目录 = `workspaces/<id>`（唯一授权写区）
  - 历史记录 = `sessions/<id>/messages.jsonl`、元信息 = `sessions/<id>/meta.json`
  - 明示「忽略与本节无关的任何先前上下文」「严禁读写本会话工作目录以外的任何路径」
- 注入时机：`sysPromptFp`（约定 sha1 指纹）不匹配 或 网关会话重建（load 失败新建/首次新建）时；失败记录 `sysPromptFailed` 避免每次卡顿。

## 5. 服务端连接池（AgentSessionService / Registry）

- `ConnState` = AgentSessionService 实例（connectionId/token/activeSessionId/models/sessionConfig/usage/queueTail/cancelledSids/**running**）。
- `conns: Map<string, ConnState>` = AgentSessionRegistry；`getConnFor(key)` 惰性建连，`withConnLock` 本连接内串行、跨连接并行。
- **running 保活**：prompt 进锁置 `running=true`，`finally` 复位；空闲回收跳过 running 连接——「切走的任务继续跑」的物理前提。
- 语义别名导出：`export type AgentSessionService = ConnState; export type AgentSessionRegistry = Map<string, ConnState>;`（文档-代码对齐用）。

## 6. 前端 Registry（AgentSessionUi 视图缓存）

- `uiRef: Map<sid, SessionUi>`：`{msgs, cursor, hasMore, loaded, loading, lastUsed}`。
- `commitMsgs(sid, updater)`：写缓存 → 触达 LRU → **仅当 sid===currentIdRef.current 时 setMsgs**（渲染守卫内聚，替代散落的 currentId 判断）。
- `commitPage(sid, patch)`：写分页游标，激活会话同步 setMsgCursor/setHasMoreMsgs。
- `loadIntoUi(id, {scroll})`：缓存命中直接激活视图（不 fetch）；未加载才 fetch，代际号过期丢弃；加载中并发去重（loading 标志）。
- `evictUi(keepId)`：`uiRef.size > UI_CACHE_MAX(10)` 时按 lastUsed 升序淘汰非 keep、非 running、已加载的项。
- `mergeRunIntoView(id)`：切回时把 runsRef 里的流式半成品合并进缓存（不中断、不重复）。
- `gwRef: Map<sid, GatewayInfo>` + `gw` state：per-session 网关态视图；切会话/连接后/设置变更后由 `loadGw(id)` 刷新。

## 7. status 拆分（全局 vs per-session）

| 字段 | 归属 | 来源 |
|---|---|---|
| phase / discovered（网关进程·端口·心跳）/ lastError / capabilities | 全局 | `GET /api/agent/status`（无 sid，轮询 3s） |
| connectionIdMasked / protocolVersion / acpSessionId / authMethods / models / sessionConfig / usage | per-session | `GET /api/agent/status?sid=<id>`（切会话/连接后拉取） |

服务端 `status(key?)` 已按 key 返回各连接状态；前端 `toGw()` 从 AgentStatus 提取会话字段写入 gwRef/gw。附加信息中的「会话模型」改读 `gwRef.current.get(sid)`。

## 8. API 契约（REST 形态不变）

| 接口 | 变化 |
|---|---|
| `GET /api/agent/status?sid=` | 新增 query 支持（无 sid 行为不变） |
| `POST /api/agent/audit {id, cutoffMs?}` | 新增；返回 `{violations: [{path,mtime,size}]}` |
| prompt / cancel / set-model / set-config / sessions / activate / system-prompt | 不变（均已 localSessionId 透传） |

前端任务 `finally` 后自动调 audit；检出越界写入时顶部显示可关闭警告条（auditWarn）。

## 9. 迁移与兼容

- 存量 11 个会话：artifacts 已迁入 workspaces、meta.acpCwd 已重指（2026-09-27 实测：w62l 4 件产物、2yom 等全部就位）。
- 迁移失败单会话隔离；migrated 标志保证幂等。
- 硬隔离（delegateToolsSupport 工具委派 + realpath 白名单）下一迭代验证后启用。

## 10. 关键文件索引

- `src/infrastructure/workbuddy-acp.ts`（859 行）— 连接池/running 保活/语义别名/注入文本
- `src/infrastructure/agent-session-store.ts` — Repository：工作区/迁移/审计
- `src/infrastructure/agent-session-activate.ts` — 激活 + 双目录注入
- `src/components/site-browser/local-agent-panel.tsx` — 前端 Registry/LRU/status 拆分/审计提示
- `src/app/api/agent/{status,audit}/route.ts` — per-session status + 审计
