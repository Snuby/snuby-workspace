# Spec 017 — 任务（AgentSession 对象化架构）

状态图例：`[x]` 完成 · `[ ]` 未开始 · `[~]` 进行中

## 任务清单

- `[x]` #45 现状梳理：读通 workbuddy-acp.ts / agent-session-store.ts / agent-session-activate.ts / API 路由 / 前端状态消费点
- `[x]` #46 服务端 AgentSessionService 语义化：ConnState=Service、conns=Registry 别名；running 保活（空闲回收跳过运行中连接）；prompt 进锁/退出复位
- `[x]` #47 AgentSessionRepository 存储分离：agent-workspaces 根 + workDirOf + migrateWorkspaces（幂等惰性迁移 artifacts 与 meta.acpCwd）+ auditWorkspaceViolations + deleteSession 双清 + listArtifacts 改读工作区
- `[x]` #48 前端 AgentSessionRegistry：uiRef/gwRef/commitMsgs/commitPage/loadIntoUi/mergeRunIntoView/evictUi（UI_CACHE_MAX=10，运行中不淘汰）；switchSession/createLocalSession/loadMoreMsgs/send/connect/applyModel/applyConfig 全链路接缓存；docHints 改用会话工作目录；任务后自动越界审计 + auditWarn 警告条
- `[x]` #49 status 拆分：`status?sid=` 接口 + 前端 toGw/gw/loadGw；顶栏全局态、信息行/模型/配置/用量 per-session；附加信息「会话模型」读 gwRef
- `[x]` #50 构建、重启与验证：tsc 通过；next build 通过（BUILD_ID `_Cn3oZC0-7GnNzqcVw8tA`）；存量 11 会话迁移验证（w62l 产物 4 件入工作区、meta.acpCwd 重指）；3310 + Electron(9222) 重启；status 接口无 sid/sid 双态可用
- `[x]` #51 文档：本 spec 四件套；README/conventions 已核对（SDD 流程一致性；术语 AgentSession* 与代码命名一致）

## 待办（用户验证后关单）

- `[ ]` 用户页面验证：双会话并发任务输出不串、切回不重拉、模型/用量跟随会话、审计无越界误报
- `[ ]` （下一迭代）delegateToolsSupport 硬隔离实测（工具委派 + realpath 白名单）
- `[ ]` （可选）UI_CACHE_MAX 接入设置页可配

## 验证记录

- 2026-09-27：tsc --noEmit 全绿；next build 成功；`GET /api/agent/status`（phase: idle，网关未连时）与 `?sid=` 均可响应；sessions 接口 200；workspaces 11 会话目录建立、旧 artifacts 无非空残留、meta.acpCwd 抽查（w62l/2yom）指向新工作区。
