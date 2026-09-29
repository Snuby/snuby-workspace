# Spec 017 — 任务（AgentSession 对象化架构）

状态图例：`[x]` 完成 · `[ ]` 未开始 · `[~]` 进行中

## 任务清单

- `[x]` #45 现状梳理：读通 workbuddy-acp.ts / agent-session-store.ts / agent-session-activate.ts / API 路由 / 前端状态消费点
- `[x]` #46 服务端 AgentSessionService 语义化：ConnState=Service、conns=Registry 别名；running 保活（空闲回收跳过运行中连接）；prompt 进锁/退出复位
- `[x]` #47 AgentSessionRepository 统一布局：`agent-sessions/<id>/`（meta/messages/artifacts，cwd=会话目录）+ workDirOf + auditWorkspaceViolations + deleteSession + listArtifacts
- `[x]` #48 前端 AgentSessionRegistry：uiRef/gwRef/commitMsgs/commitPage/loadIntoUi/mergeRunIntoView/evictUi（UI_CACHE_MAX=10，运行中不淘汰）；switchSession/createLocalSession/loadMoreMsgs/send/connect/applyModel/applyConfig 全链路接缓存；docHints 改用会话工作目录；任务后自动越界审计 + auditWarn 警告条
- `[x]` #49 status 拆分：`status?sid=` 接口 + 前端 toGw/gw/loadGw；顶栏全局态、信息行/模型/配置/用量 per-session；附加信息「会话模型」读 gwRef
- `[x]` #50 构建、重启与验证：tsc 通过；next build 通过；统一目录布局验证；3310 + Electron 重启；status 接口无 sid/sid 双态可用
- `[x]` #51 文档：本 spec 四件套；README/conventions 已核对（SDD 流程一致性；术语 AgentSession* 与代码命名一致）

## 待办（用户验证后关单）

- `[ ]` 用户页面验证：双会话任务经队列串行时输出不串、切回不重拉、模型/用量跟随会话、审计无越界误报
- `[ ]` （下一迭代）delegateToolsSupport 硬隔离实测（工具委派 + realpath 白名单）
- `[ ]` （可选）UI_CACHE_MAX 接入设置页可配

## 用户操作矩阵落地（design §11.5，文档已定稿）

- `[x]` #52 文档：design.md §11 用户操作矩阵；requirements AC-7～AC-10；能力文档复测回写
- `[x]` #53 切换零网关：switchSession 仅 loadIntoUi + loadGw（只读 status），不调 activate（AC-7）
- `[x]` #54 重连策略：connect 前 resetAgentConnections；前端中断展示流 + needsAlign + 横幅；不静默重放（AC-8）
- `[x]` #55 删除拦截：前端 running 禁用 + API 409 `isLocalSessionBusy`（AC-9）
- `[x]` #56 排队文案与可取消：queued 事件带 aheadTitle；「取消排队」走 cancel（AC-10）
- `[x]` #57 全局串行：activate+prompt 同锁；set-model/set-config 对齐目标会话后入队；inject bypass 防死锁
- `[x]` #58 新建会话：仅本地 createSession，网关 new+注入延迟到首次发送（activateUnlocked 在 prompt 锁内）

## 验证记录

- 2026-09-28：会话与工作区合并为单一 `agent-sessions/<id>/`；移除 `agent-workspaces` / `migrateWorkspaces` / 布局标记等迁移入口。
- 2026-09-27：tsc --noEmit 全绿；next build 成功；`GET /api/agent/status`（phase: idle，网关未连时）与 `?sid=` 均可响应；sessions 接口 200。
