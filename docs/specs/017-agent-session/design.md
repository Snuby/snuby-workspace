# Spec 017 — 设计（AgentSession 对象化架构）

## 1. 聚合根：AgentSession

同一 `sessionId`（`data/agent-sessions/<id>` 的目录名）贯穿三层，是会话的唯一标识与关联键。

```
AgentSession（聚合根, sessionId 贯穿三层）
├── Identity     meta.json：id / title / createdAt / updatedAt / acpSessionId / acpCwd / model / sysPromptFp
├── UiState      （前端内存）AgentSessionUi：msgs / cursor / hasMore / loaded / loading / lastUsed
├── Workspace    （磁盘）agent-sessions/<id>/：cwd 指向 + artifacts/（唯一授权写区）
├── GatewayState （服务端）AgentSessionService：连接 + 网关会话 + 配置缓存 + 队列 + running
└── RunState     （前端内存）runsRef：每个会话最多一个并行任务（msgId/text/tools/ac）
```

### 命名族（三层对称）

| 概念 | 前端 | 服务端 | 磁盘 |
|---|---|---|---|
| 会话视图/网关态 | `AgentSessionUi`（uiRef 缓存） | `AgentSessionService`（ConnState 语义别名） | `AgentSessionRepository`（store） |
| 注册表 | `uiRef` Map + `gwRef` Map | `conns` Map（Registry 别名） | `SESSIONS_ROOT` 目录 |

## 2. 四层防串矩阵

| 层 | 机制 | 状态 |
|---|---|---|
| 渲染 | 单指针 currentIdRef + 代际守卫 loadSeqRef + commitMsgs/commitPage 按 sessionId 落缓存、仅激活会话 setMsgs | ✅ 本轮实现 |
| 网关 | per-session 连接（key=localSessionId）+ per-session cwd + 连接级错误重建 | ✅ 既有（spec 017 前） |
| 文件 | `sessions/<id>` 物理分离 + 注入约定强约束 + 任务后越界审计 + UI 警告 | ✅ 本轮软隔离；硬隔离（delegateToolsSupport + realpath 白名单）待验证 |
| API | 路由一律以 `localSessionId` 定位连接/会话；`status?sid=` 返回会话自己的网关态 | ✅ 既有 + 本轮 |

## 3. 存储布局（AgentSessionRepository）

```
~/snuby-workspace-data/                 # 用户数据根（与软件目录分离）
└── agent-sessions/
    ├── <session-id>/
    │   ├── meta.json                   # Identity
    │   ├── messages.jsonl              # 历史对话（每行一条 JSON）
    │   └── artifacts/                  # 任务产物（必须写在这里）
    ├── system-prompt.txt               # 全局工作约定（所有会话注入）
    └── model-preference.json           # 模型偏好（新会话恢复）
```

- 环境覆盖：`SNUBY_USER_DATA` / `AGENT_SESSIONS_PATH`。
- `cwd` / `meta.acpCwd` 恒等于该会话目录；`workDirOf === dirOf`。
- `auditWorkspaceViolations(id, {cutoffMs})`：扫描本会话目录之外的所有会话目录，返回 cutoff 窗口内有新写入的文件清单（软隔离兜底证据）。
- `deleteSession` 删除整个 `agent-sessions/<id>/`。

## 4. 激活与注入（activateLocalSession）

- `cwd = meta.acpCwd ?? workDirOf(id)`，网关 cwd 恒指向会话目录。
- 注入文本 `buildSessionSetupText(sysPrompt, workDir, dataDir)`：
  - 工作目录/产物目录 = `sessions/<id>`（唯一授权写区）
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

## 9. 兼容与后续

- 统一布局：`agent-sessions/<id>/` 同时承载 meta/messages 与 cwd/artifacts；无独立 workspaces 目录、无迁移入口。
- 硬隔离（delegateToolsSupport 工具委派 + realpath 白名单）下一迭代验证后启用。

## 10. 关键文件索引

- `src/infrastructure/workbuddy-acp.ts` — 连接池/running 保活/语义别名/注入文本
- `src/infrastructure/agent-session-store.ts` — Repository：会话目录/审计
- `src/infrastructure/agent-session-activate.ts` — 激活 + 注入
- `src/components/site-browser/local-agent-panel.tsx` — 前端 Registry/LRU/status 拆分/审计提示
- `src/app/api/agent/{status,audit}/route.ts` — per-session status + 审计
- 网关能力事实源：`docs/acp-gateway-capability.md`（2026-09-27 初测 + 复测）

## 11. 用户操作矩阵（多会话边界）

依据 `docs/acp-gateway-capability.md` 复测事实。一句话原则：

> **用户可随时切换视图；网关活动会话只在「该会话获得全局执行权」时改变；重连使所有网关绑定失效；停止只保证本地停，不保证网关停。**

### 11.1 网关物理定律（不可协商）

| # | 事实 | 设计推论 |
|---|---|---|
| 1 | `session/prompt` 忽略 sessionId，按**活动会话**（最后 new/load）路由 | 执行前必须对齐目标会话；禁止并发 prompt |
| 2 | `cwd` 完全无效 | 隔离靠注入约定 + 工作区目录 + 审计 |
| 3 | 同连接并发 → 流错乱 | **全局串行队列**（跨连接也不得并行执行） |
| 4 | cancel 断客户端流；后台续跑/残流污染**未稳定复现** | 不依赖 cancel 语义；可保留防御性吞流 |
| 5 | load 可切活动会话；上下文恢复多数可用但非唯一真相 | 历史以本地 `messages.jsonl` 为准 |
| 6 | 网关 `.jsonl` 写入**活动会话**文件，非 prompt 里的 sessionId | 未对齐就 prompt = 写错会话文件 |

### 11.2 每会话状态机

```
idle ──发送──► queued ──获全局锁──► aligning(load|new+注入) ──► running ──► idle
                 │                      │                         │
                 └─取消排队──► idle     └─失败──► idle(错误)      └─停止──► draining(吞流)──► idle
```

- **全局锁持有者**：仅 `aligning` / `running` / `draining`。
- **不持锁**：`idle` / `queued`、纯 UI 切换、浏览历史、编辑输入框。
- **正交全局态**：`gateway: disconnected | connecting | connected`（与 per-session 状态独立）。

### 11.3 操作 × 允许 / 禁止

#### 发送任务

| 场景 | 行为 | UI |
|---|---|---|
| 本会话 idle | 入全局队列 → aligning → running | 正常发送 |
| 本会话已 running / draining | **禁止再发**（或仅允许追加到本会话队列末，二选一，默认禁止） | 发送按钮禁用 |
| 他会话 running | 允许入队；轮到时再对齐**消息所属会话**（不是当前 UI 会话） | `排队中（前序：会话「xxx」）`；可取消排队 |
| 点发送的语义 | 「为该消息所属会话预约一次全局执行权」 | 非「立刻对网关说话」 |

#### 切换会话

| 允许 | 禁止 |
|---|---|
| 随时切 UI、看历史、改输入框 | 切 UI 时对网关 `load` 目标会话（除非立刻要在该会话执行） |
| 切回命中 uiRef：不重拉磁盘 | 切会话时自动 cancel 他会话任务 |
| 运行中会话侧栏角标「运行中」；切回 `mergeRunIntoView` | 把 A 的流 `setMsgs` 到 B（必须 `commitMsgs(sid)` + currentId 守卫） |

要点：**切换 = 纯前端视图操作**；网关活动会话只在获得全局执行权时改变。

#### 新建会话

| 步骤 | 边界 |
|---|---|
| 本地先建 `sessions/<id>`（含 artifacts/） | 先有本地 id，再碰网关 |
| `session/new` + 注入 | 占全局队列；若队列忙则排队或**延迟到首次发送**（推荐延迟，减少空会话占锁） |
| 新建后自动切到新会话 | 仅视图切换；不 cancel 旧任务 |
| 初始化中 | UI 可标「初始化中」，发送可等到对齐完成 |

#### 重连 ACP（断线 / 手动重连 / 网关进程更换）

| 必须 | 禁止 |
|---|---|
| 丢弃全部 connectionId/token，连接池重建 | 假定旧 `acpSessionId` 在新连接上仍是活动会话 |
| 重连后：`gateway=connected`，各会话标记 **needsAlign** | 重连瞬间对所有会话批量 load |
| 每个会话在**下一次发送前**再 load（失败则 new 并回写 meta） | 静默重放重连前未完成的 prompt |
| 运行中任务 → 标 interrupted，落盘；排队项提示「需重发」或清空排队 | 把旧连接上的流当成可续传 |

文案：`网关已重连，下次发送时自动恢复本会话`。

#### 停止 / 取消

| 操作 | 语义 |
|---|---|
| 取消排队 | 标 token，轮到时跳过——**优先提供，安全** |
| 停止运行中 | 本地立刻停展示 + `session/cancel`；服务端防御性吞流至结束再放行队列 |
| 停止后立刻发他会话 | 允许入队；真正执行须等 draining 放行 |
| 用户可见承诺 | 「已停止显示；网关侧可能仍在收尾」——不承诺网关已停 |

#### 删除 / 重命名

| 操作 | 边界 |
|---|---|
| 删 idle 会话 | 删 `sessions/<id>`；网关侧会话可不删（允许孤儿 `.jsonl`） |
| 删 running / queued / draining | **先取消或停止并等收尾**，再删；否则回调写已删 id |
| 重命名 | 只改本地 title |

#### 改模型 / 配置 / 系统约定

| 操作 | 边界 |
|---|---|
| set-model / set-config | 先对齐目标会话，与 prompt **同一全局队列** |
| 他会话 running 时改当前会话配置 | 排队；UI 显示等待 |
| 改全局 system-prompt | 只更新指纹；各会话**下次 aligning** 再注入，禁止全量扫射 prompt |

#### 关闭面板 / 刷新 / 退出应用

- 前端销毁 ≠ 网关任务停止。
- 再打开：以本地 messages 为准；无法续流则标 interrupted。
- 退出前尽力 cancel，短超时，不长时间阻塞退出。

### 11.4 文案与可观测性

| 场景 | 文案 |
|---|---|
| 排队 | `排队中（前序：会话「xxx」）` |
| 重连后 | `网关已重连，下次发送时自动恢复本会话` |
| 停止 | `已停止显示；网关侧可能仍在收尾` |
| 越界审计 | 既有 auditWarn 条 |
| 侧栏运行中 | 角标「运行中」，点入见半成品流而非空白重拉 |

### 11.5 落地检查清单（2026-09-27 已闭合）

- [x] 全局串行：activate+prompt 同 `withGlobalAgentLock`；set-model/set-config 入队并对齐目标本地会话；inject 用 `bypassGlobalQueue`
- [x] 切换零网关：`switchSession` 不调 activate（仅 UI + 只读 status?sid=）
- [x] 新建延迟到首次发送再对齐/注入
- [x] 重连：`resetAgentConnections` + 前端 interrupted / needsAlign 横幅
- [x] 删除：`isLocalSessionBusy` → 409；前端禁用
- [x] 排队文案 aheadTitle + 取消排队
- [x] 执行层全局串行（per-session 连接仅承载，不并行 prompt）
- [ ] （可选）停止后 UI 明示「等待上一任务收尾」倒计时；单连接池简化
