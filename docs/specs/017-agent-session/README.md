# Spec 017 — AgentSession 对象化架构（本地 Agent 会话隔离重构）

状态：implementing（服务端/存储/前端已实现并通过构建；页面并发验证待用户确认后关单）

## 背景与问题

「本地 Agent」多会话并发实测暴露**会话串台**：用户在会话 A 发起任务，WorkBuddy 的 Bash/Read/Write/Edit 工具直通整块磁盘，把产物与消息写进了会话 B 的目录（2yom 任务读写 w62l 的 `messages.jsonl` 与 `artifacts/机器学习算法概述.md`）。前端渲染层此前已隔离（loadSeqRef 代际守卫 + send 渲染守卫），但**文件系统层零隔离**：`cwd` 只是起点不是边界。

根因：网关能力 `initialize` 声明 `clientCapabilities.fs.readTextFile=false/writeTextFile=false`，工具由网关侧（WorkBuddy 进程）执行，工作台无法从协议层约束其读写路径。

## 目标

1. 把散落的前端 state / 服务端连接池 / 磁盘存储收敛为聚合根 **AgentSession**，同一 sessionId 贯穿三层。
2. **根治会话串台**：按「渲染 → 网关 → 文件 → API」四层防串矩阵设计，物理隔离 WorkBuddy 的写权限范围。
3. 切换会话不丢内存态：per-session 视图缓存 + LRU（运行中会话强制保活不淘汰），已加载的会话切回不重拉磁盘。
4. `status` 拆分：全局字段（网关发现/连接相位）与 per-session 字段（模型/配置/用量/连接 ID）分离，杜绝「会话 B 显示了会话 A 的模型」。

## 核心决策（详见 design.md）

1. 命名族：**AgentSession / AgentSessionUi / AgentSessionService / AgentSessionRepository / AgentSessionRegistry**（用户 2026-09-27 确认）。
2. 存储分离：`data/agent-sessions/<id>/`（内部数据：meta/messages）+ `data/agent-workspaces/<id>/`（授权工作区：cwd 指向这里、产物只写这里）；一次性迁移历史会话 artifacts 与 `meta.acpCwd`。
3. 隔离顺序：**软隔离先行**（工作区分离 + 任务后越界审计 + 强提示），硬隔离（delegateToolsSupport 工具委派 + realpath 白名单）待网关协议实测后再上。
4. REST API 形态不变（前端重构不依赖 API 变更）；新增 `status?sid=` 与 `audit` 两个只读接口。
5. 服务端连接池语义化对齐：`ConnState` = AgentSessionService 实例，`conns` Map = AgentSessionRegistry；新增 `running` 保活标志，运行中连接不参与空闲回收。

## 非目标

- 不实现 delegateToolsSupport 硬隔离（未验证协议，留作下一迭代）。
- 不做多账号 partition（全局统一 `default` 持久化，用户已定）。
- 不改 REST API 的既有请求/响应形状。
- Web 版（3300）不维护。

## 交付物

- `src/infrastructure/workbuddy-acp.ts` — 连接池语义化（AgentSessionService/Registry 别名）+ running 保活
- `src/infrastructure/agent-session-store.ts` — 工作区根/迁移/越界审计（AgentSessionRepository）
- `src/infrastructure/agent-session-activate.ts` — 激活注入改用 workDir + dataDir 双目录
- `src/app/api/agent/status/route.ts` — 支持 `?sid=` per-session 网关态
- `src/app/api/agent/audit/route.ts` — 越界写入审计接口（新增）
- `src/components/site-browser/local-agent-panel.tsx` — 前端 AgentSessionRegistry（uiRef/gwRef/commitMsgs/commitPage/loadIntoUi/loadGw/evictUi + UI_CACHE_MAX LRU + auditWarn 提示条）
- `docs/specs/017-agent-session/` 四件套（本目录）

## 变更记录

- 2026-09-27: 初版（implementing）。服务端 running 保活、存储分离+迁移+审计、status?sid、前端 Registry/LRU/status 拆分全部实现；tsc 通过、next build 通过（BUILD_ID `_Cn3oZC0-7GnNzqcVw8tA`）；存量 11 会话 artifacts 迁移验证通过（w62l 产物 4 件均入工作区）；3310 + Electron(9222) 已重启。页面级「双会话并发不串台 / 切回不重拉」待用户验证后关单。
