# Spec 018 — 设计（作品创作 / Agent Work）

> 收束对话设计 v0.1–v0.6。实现前以本文 + requirements.md 为准。  
> **UI 见 `ui.md`。** 修订：§3.1 库索引、§3.2 多 scope **历史轨道**（ACP 仍作品级；发布按 pubId 分历史）。

## 1. 定位

**Work** = 一篇（组）自媒体向内容的创作聚合根。  
**氛围式创作** = 将该作品生命周期（素材 → 多版草稿 → AI 协作 → 发布快照）收敛到 `agent-works/<workId>/`，并在同一逻辑任务内与 AI 协作。

初期类型：`article`（长文/短文/图文均为同一 Markdown 草稿；平台差异在发布阶段处理）。

---

## 2. 分层架构

```
API / UI
  → agent-work | agent-session（领域）
  → agent-runtime（Task 队列/锁/align/inject/run/audit）
  → agent-acp（连接池/协议）
```

| 独立（作品域） | 共享（Runtime） |
|---|---|
| 目录 schema、Draft/Resource/Publish | 全局锁、串行队列、连接池 |
| WorkContextProvider、work conventions | align / inject 管道 / audit 框架 |
| `/api/work/*` | TaskKey、AlignReason、permission 挂载点 |

**禁止**：作品调用 `activateLocalSession` / `agent-session-store`。  
**本地 Agent 反哺**：会话改为 `LocalSessionContextProvider` 挂同一 Runtime（波次 W4）；注入策略与作品**分文件**，不可共用一份 runtime.md。

---

## 3. 磁盘布局

```
<app-resources>/agent-conventions/          # 包内只读默认
├── manifest.json
└── work/
    ├── runtime.md
    ├── article-workflow.md
    ├── inject-head-*.md.tpl
    ├── inject-tail-*.md.tpl
    └── reminder.md.tpl

~/snuby-workspace-data/
├── agent-conventions/                      # 用户覆盖层（可选）
├── agent-sessions/                         # 017
└── agent-works/
    ├── library.json                          # 作品集文件夹树 + workId 挂载（实体目录仍扁平）
    └── <workId>/
        ├── meta.json                         # 可冗余 folderId
        ├── context-state.json
        ├── collab/                           # 历史轨道（非多 ACP）；见 §3.2
        │   ├── draft/messages.jsonl
        │   ├── publish/<pubId>.jsonl
        │   └── resources/<resourceId>.jsonl
        ├── artifacts/
        ├── resources/
        │   ├── resources.json              # 含 revision
        │   └── …
        ├── drafts/
        │   ├── drafts-branches.json
        │   └── <draftId>/
        │       ├── content.md
        │       └── draft_meta.json
        └── publish/
            ├── .staging-<pubId>/             # 写入中
            └── <pubId>/                      # ready
                ├── publish_meta.json
                ├── content.*
                └── resources/                # 镜像
```

环境：`SNUBY_USER_DATA` / 建议 `AGENT_WORKS_PATH`。

### 3.1 作品库 `library.json`（UI：目录树 / 作品集）

- 文件夹可嵌套；节点挂 `workId[]` 或子 folder；**不**把作品物理挪进嵌套文件夹（重命名/移动只改索引）。  
- API：`/api/work/library`；创建作品带 `folderId`。详见 `ui.md` §2、§8.1-A。  
- **repairLibrary（后置）**：扫描 `agent-works/*/meta.json`，将索引缺失的 work 挂到「未分类」；修文件夹空洞与重复挂载。实现排期见 tasks `#018-20c`，不挡 MVP 创建/列表主路径。

### 3.2 协作消息 scope（历史轨道 ≠ ACP 会话）

**铁律：ACP / 逻辑任务 = 作品级唯一；scope 只拆历史文件与 UI/摘录。**

| scope | 路径 | UI |
|---|---|---|
| `draft` | `collab/draft/messages.jsonl` | 稿件创作右栏 |
| `publish` + `pubId` | `collab/publish/<pubId>.jsonl` | 发布视图右栏（随选中项变） |
| `resource` + `resourceId` | `collab/resources/<rid>.jsonl` | 资源 Agent 协作预览壳 |

- `TaskKey` / `meta.acpSessionId` / `switched_task`：**只随 workId（及 kind）变**；换 scope **不**触发 `switched_task`。  
- `POST .../run` / `GET .../messages`：必带 `scope`；`resource` 必带 `resourceId`；`publish` 必带 `pubId`。  
- 预加载：作品级 L0/L1 地图照旧；`history_snippet` **仅当前 scope** jsonl。  
- 删资源/发布项：清理对应 jsonl。详解见 `ui.md` §6。

### 3.3 （原 §3 后续）领域文件说明接 §4

---

## 4. 领域模型

### 4.1 meta.json

`id`, `title`, `type: "article"`, `status`, `currentDraftId`（权威指针）, `createdAt`, `updatedAt`, `acpSessionId?`, `conventionFp?`, `preloadFailed?`, `model?`

### 4.2 drafts

- `draft_meta.json`：`id`, `parentId`, `createdAt`, `source: "manual"|"restore"`, …
- `drafts-branches.json`：`{ version, nodes[], currentId }`
- 保存：规范化换行后整文件 diff；有 diff → 新节点；无 diff → no-op
- checkout：只改指针；再保存才分叉
- **原子双写** meta.currentDraftId ↔ branches.currentId；崩溃后 `repairPointers()` 以 meta 为准

### 4.3 resources.json

```
{ version, revision, items: [{
  id, name, kind: "url"|"document"|"media",
  url?, relativePath?, mime?, size?,
  note?, noteUpdatedAt?, createdAt, updatedAt
}]}
```

- 所有 kind 可有 note；AI 使用时必须带上  
- URL：可仅索引；`analyze-url` → note 短结论 + `artifacts/url-analyze-<rid>.md`，note 内挂路径；可选 `artifacts/note-patch-<rid>.md` 供结束钩子合并  
- 变更经 ResourceService；`baseRevision` CAS；tmp+rename；进程内 mutex  
- **一期白名单**：url；`.md/.txt/.markdown`；`.png/.jpg/.jpeg/.gif/.webp`；其余 415

### 4.4 publish

- `publish_meta.json`：platform, fromDraftId, contentFormat, resourceMap?, status, createdBy  
- MVP：完整 `publish-prepare` 可后置；设计上允许 Agent 写 staging  

### 4.5 collab 消息行

字段对齐会话习惯，并增：`kind?: "user"|"assistant"|"inject"`, `capability?`, `scope?`  
GET 默认过滤 inject。聊天上传 = 登记 resource。路径见 §3.2。

---

## 5. AgentRuntime 与 Task

### 5.1 TaskKey

`task:local-session:<id>` | `task:work:<id>`  
连接池 / 全局锁统一用 TaskKey；过渡期会话可读旧裸 id。

### 5.2 状态机

```
idle → queued → aligning → running → idle
              ↘ cancel     ↘ fail
              stop → draining → idle
```

UI 切换任务：**零网关**。网关活动上下文仅在获锁 aligning 时改变。与 017 §11 物理定律一致。

### 5.3 关键动作

enqueue → acquireLock → alignGateway → preloadContext(reason) → injectOrPrefix → executePrompt → appendMessage → audit → releaseLock

### 5.4 AlignReason 优先级

信号：bindingMissing, gatewayRecreated, switchedTask, conventionChanged, preloadFailed, firstAlignMarker, sameTask, **scopeChanged**（同 TaskKey 内）

| 优先 | Reason | 预加载 |
|---|---|---|
| 高 | first_run / gateway_recreated | 全量 + 历史摘录 |
| | switched_task | 全量 + 历史摘录 |
| | convention_fp_changed / preload_failed_retry | 全量 + 历史摘录 |
| 低 | same_task_continue | 短提醒；若 scopeChanged 则 **另附当前 scope 历史摘录**（不加全量 L0） |

A→B→A 即使 fp 不变也必须 `switched_task` 全量（017 实测）。

**非条件：** 同一 `task:work:<id>` 下仅变更 `scope` / `capability` / `pubId` / `resourceId` → **不得**记为 `switched_task`。

#### 同作品多 scope 软隔离（方案 A，MVP）

网关 ACP 会话作品级唯一，换 scope 无法物理清空模型记忆。MVP 采用 **软隔离**：

1. 每轮 run 的 prefix/capability_addon 含短声明：本轮只处理当前 scope，忽略其他轨道闲聊；权威历史见对应 `collab/...` 路径。  
2. 附带 **当前 scope** 近期历史摘录（`scopeChanged` 时必带；同 scope 续跑可缩短）。  
3. **不做**每 scope 独立 ACP（否决）；效果不佳时再评估加长声明或 standalone 重注入（方案 B）。

#### 同作品单 flight

同一 `task:work:<id>` **同时最多一个** in-flight run（与全局锁一致）。  
UI：任一栏 running 时，同作品其他 Agent 栏禁用发送并提示「作品内任务进行中」；他作品/会话仍可入全局队列。

### 5.5 ContextProvider

`workspaceRoot`, `read/writeBinding`, `buildPreload`, `buildReminder?`, `appendMessage`, `auditScanRoots`, `auditIgnore`, `isDraftDirty?`

Runtime **不改** bundle.text，只发送与记 marker。

### 5.6 PreloadBundle

`reason`, `full`, `suggestedMode`, `text`, `contentFp`, `conventionFp`, `segments[]`, `workspaceRoot`, `facts?`  

全量段注册表（顺序）：head → runtime → article_workflow → meta → current_draft_ptr（**只路径**）→ resources_index → draft_graph → artifacts_list → publish_list → history_snippet → capability_addon → tail  

写入 `context-state.json`（segments 字节与 sha1）便于审计。

### 5.7 Conventions

包内默认 + userData 覆盖；汇总 `conventionFp`；变更触发全量。

---

## 6. 写权限矩阵（宿主强制）

提示词辅导 + **path-policy 在 session/request_permission 自动 allow/deny/ask**。

路径类：`PROTECTED` | `CURRENT_CONTENT` | `OTHER_DRAFT` | `RESOURCES_BLOB` | `ARTIFACTS` | `PUBLISH` | `OUTSIDE`

| Capability | ARTIFACTS | BLOB | resources.json | CURRENT_CONTENT | OTHER_DRAFT | PUBLISH | PROTECTED |
|---|---|---|---|---|---|---|---|
| general | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| edit-draft | ✅ | ❌ | ❌ | ✅ 且 !dirty | ❌ | ❌ | ❌ |
| analyze-url | ✅ | ❌ | ❌→Service | ❌ | ❌ | ❌ | ❌ |
| ingest-resource | ✅ | ✅ | ❌→Service | ❌ | ❌ | ❌ | ❌ |
| publish-prepare | ✅ | 读 | ❌ | 读 | 读 | ✅ staging | ❌ |

PROTECTED（Agent 禁直写）：`meta.json`、`context-state.json`、`drafts/drafts-branches.json`、`resources/resources.json`、以及 **`collab/` 下全部历史文件**（`**/messages.jsonl`、`publish/*.jsonl`、`resources/*.jsonl`）。  
Shell 启发式：对 drafts/resources/publish/PROTECTED/collab 的 rm/mv 等 → deny；解析失败 → ask（作品偏严）。  
模块：`agent-work/path-policy.ts`。

---

## 7. Dirty、保存冲突、半成品

### Dirty（E3）

- 前端持有 dirty；`POST run` 带 `draftDirty`  
- `edit-draft && dirty` → **入队前** 409 `draft_dirty`  
- path-policy 双保险 deny 写 CURRENT_CONTENT  

### 保存 baseline

```json
{ "content", "baseline": { "draftId", "contentSha1", "mtimeMs" } }
```

- pointer 变 → `draft_pointer_changed`  
- 盘 sha1 ≠ baseline → `draft_conflict`  
- Agent `edit-draft` done 应带回新 sha1；前端未 dirty 时刷新缓冲与 baseline  

### 原子写

单文件：`.tmp` → fsync → rename  
publish：先 `publish/.staging-<pubId>/`，成功再 promote 为正式目录；列表默认只展示 ready  

edit-draft SHOULD：先 `content.md.agent-tmp` 再 rename  

---

## 8. Markdown 资源路径

正文引用统一：`![…](resources/相对路径)`（相对 **work 根**）。  
发布时拷贝镜像并改写链接；`resourceMap` 记入 publish_meta。

---

## 9. Capability

同 work、**同一 ACP / TaskKey**；多 scope 仅多份历史与摘录。RunRequest 带 scope + capability + extras。

| id | 用途 | MVP |
|---|---|---|
| general | 策划讨论 | ✅ |
| edit-draft | 改当前 content.md | ✅ |
| analyze-url | URL → note + artifacts | ✅ |
| ingest-resource | 整理素材 | 可后置 |
| publish-prepare | 写 publish | 可后置（矩阵先定） |

---

## 10. 越界审计

`auditAfterRun(taskKey, { sinceMs })`  

WorkProvider 扫描：其他 `agent-works/*` + 全部 `agent-sessions/*`  
忽略书记文件名；抓实体/artifacts 等近期 mtime  
会话反哺后应对称扫描 works（W4）

---

## 11. API

### 作品域 `/api/work`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/work` | 列表 / 创建 |
| GET/PATCH/DELETE | `/api/work/[id]` | 读改删；busy→409 |
| GET | `/api/work/[id]/draft` | 当前稿 |
| GET | `/api/work/[id]/draft/branches` | 版本图 |
| GET | `/api/work/[id]/draft/[draftId]` | 指定版 |
| POST | `/api/work/[id]/draft/save` | baseline + diff |
| POST | `/api/work/[id]/draft/checkout` | 改指针 |
| GET/POST | `/api/work/[id]/resources` | 列表/添加 |
| PATCH/DELETE | `/api/work/[id]/resources/[rid]` | 改/删（revision） |
| GET | `/api/work/[id]/messages` | query: `scope` + `resourceId?`/`pubId?`；默认无 inject |
| POST | `/api/work/[id]/run` | **执行主入口**；body 含 scope / resourceId? / pubId? |
| POST | `/api/work/[id]/activate` | 显式 standalone 预加载 |
| POST | `/api/work/[id]/audit` | 手动审计 |
| POST | `/api/work/[id]/open-folder` | 打开目录 |

`run` body：`text`, `capability`, `scope`, `resourceId?`, `pubId?`, `draftDirty`, `extras`, `inactivityTimeoutMs?`  
流事件：`queued|chunk|thought|tool|done|error|audit?`

错误码：`draft_dirty` | `draft_conflict` | `draft_pointer_changed` | `resource_conflict` | `resource_type_unsupported` | `work_busy`（均 409/415）

### 与 `/api/agent` 共用 Runtime

- `prompt` / `cancel` / `audit` / `status` 内转 TaskKey；保留 `localSessionId` / `sid` 兼容  
- `status?task=task:work:…` 新增  
- set-model/set-config 按目标 taskKey 入队  

---

## 12. 模块切分

```
src/infrastructure/agent-runtime/   # queue, marker, align, inject, run, audit, conventions, index
src/infrastructure/agent-acp/       # 从 workbuddy-acp 剥离的协议/连接池
src/infrastructure/agent-session/   # 现有会话领域 + 日后 provider
src/infrastructure/agent-work/      # store, draft, resource, publish, provider, path-policy, dirty
```

`workbuddy-acp.ts` 短期门面 re-export，保证 017 不破。

依赖单向：API → work/session → runtime → acp。

---

## 13. 包内 runtime.md 要点

工作区唯一根；忽略 pwd；目录角色表；渐进披露；禁止自建 draft 版本目录；dirty 禁写 content；资源 note；capability 协议；analyze-url 文件约定；`resources/` 相对路径书写；严禁越界与破坏性删树。全文初稿见设计对话 v0.5；实现时落入包内资源并由 conventions 加载器插值 `{{workDir}}` 等。

---

## 14. MVP 边界

**含**：Runtime 适配、Work CRUD、draft 保存/checkout、resources 白名单+revision、messages、run（general/edit-draft/analyze-url）、path-policy、审计、conventions、context-state  

**不含**：精美多平台发布、ingest 复杂管线、PDF/Office、引用、GC、硬隔离、conventions UI、完整创作 UI  

---

## 15. 实现波次

| 波次 | 内容 |
|---|---|
| W0 | 抽 Runtime 适配器，会话行为等价 |
| W1 | conventions + WorkProvider 预加载可审计；path-policy 挂 permission |
| W2 | Work 领域：meta/drafts/resources（baseline、revision、tmp+rename、白名单） |
| W3 | `/api/work/.../run` 真跑通 + 双向审计 + analyze-url 钩子；覆盖 AC-W* |
| W4 | LocalSessionProvider 注入文件化、去硬编码 |
| W5 | 删冗余门面、文档关单 |

正式开始建议 **W0→W3** 为作品 MVP；W4 不挡 MVP。

---

## 16. 与 017 的关系

- 复用操作矩阵思想与 ACP 物理定律，不复用会话领域与硬编码注入。  
- 作品可写面更大（整树），故 **path-policy 为作品 P0**，会话可继续软隔离+审计。  
- 全局一锁：作品与会话互斥，排队文案需 resolveTitle(taskKey)。
