# Spec 018 — 需求（作品创作 / Agent Work）

## 用户故事

1. 作为创作者，我为每一篇内容建立一个**作品**，其素材、多版草稿、AI 对话、中间产物与发布快照都在同一工作区，可回溯。
2. 作为创作者，我与 AI 在该作品内协作（改稿、分析链接、讨论），**不必**为每种能力切换「会话」；切换到另一作品时，AI 的逻辑上下文必须跟着切换且不串台。
3. 作为创作者，我手动保存才产生草稿版本；可把历史版本切为当前稿再修订（分叉）；无改动保存不产生噪声版本。
4. 作为创作者，我上传或登记素材（链接/文本/图片），可写 note；AI 使用某素材时必须带上 note；链接可先让 AI 拆解并把结论记回 note。
5. 作为创作者，编辑器有未保存修改时，AI **不能**悄悄覆盖磁盘上的当前稿；若磁盘已被 AI 改过，我保存时不能在不知情下覆盖。
6. 作为创作者，我理解作品任务与本地 Agent 会话**不能同时跑**，会排队；切换作品浏览不打断他处正在跑的任务展示语义（与 017 一致：切换零网关）。
7. 作为创作者，我用**文件夹/作品集**组织作品（可嵌套）；切换前可在面板里预览目标作品当前稿，确认后再切换。
8. 作为创作者，资源预览里有独立 AI **历史**优化 note；稿件区与**每个发布项**、各资源的历史彼此隔离；但它们共用本作品同一个 Agent 任务/ACP 绑定，无需为每个窗口「新开会话」。

## 验收标准

### 隔离与 Runtime

- **AC-W1 文件隔离**：作品 A 的 run 期间/之后，作品 B 目录与任意 `agent-sessions/*` 不得出现越界业务写入；审计可检出。
- **AC-W2 切换全量预加载**：A→B→A 后再 run，日志 `AlignReason=switched_task`，preload segments 含 `meta`、`current_draft_ptr`；组装文本**不含** `content.md` 正文。
- **AC-W3 跨 kind 互斥排队**：会话占用锁时作品 run 进入 queued，事件含前序标题（会话「…」/作品《…》）；可取消排队。
- **AC-W7a 切换零网关**：纯切换作品视图不触发 gateway load/new/prompt。

### 版本与指针

- **AC-W4 无 diff 不建版**：save 内容与磁盘一致 → `unchanged`，branches 节点数不变。
- **AC-W5 有 diff 建版**：新 `draftId`，`parentId=原 current`；`meta.currentDraftId` 与 `drafts-branches.json` 的 `currentId` 一致。
- **AC-W6 分叉**：checkout 历史版后再 save 有 diff → parent 为 checkout 目标。
- **AC-W16 指针修复**：meta/branches 经 tmp+rename；异常中断后 `repairPointers()` 以 meta 为准收敛。

### Dirty / 冲突 / 写守卫

- **AC-W7 draft_dirty**：`draftDirty=true` 且 `capability=edit-draft` → HTTP 409 `draft_dirty`，磁盘 content 不变。
- **AC-W8 能力越权 deny**：capability=general 时对当前 `content.md` 的写工具 permission → deny。
- **AC-W9 保存冲突**：baseline 与磁盘 sha1 不一致 → 409 `draft_conflict`。
- **AC-W10 受保护文件**：对 `meta.json` / `context-state.json` / `drafts/drafts-branches.json` / `resources/resources.json` / **`collab/` 下全部历史文件** 的写 → deny。

### 资源

- **AC-W11 类型白名单**：上传非 url/文本/图片（如 `.pdf`）→ 415 `resource_type_unsupported`。
- **AC-W12 analyze-url**：结束后对应 resource 的 note 含短结论，并指向 `artifacts/url-analyze-<rid>.md`；`resources.json` 的 `revision` +1。
- **AC-W13 revision 冲突**：错误 `baseRevision` 更新 → 409 `resource_conflict`。

### 披露与消息

- **AC-W14 不内联正文**：全量 PreloadBundle.text 不得包含当前 `content.md` 文件正文（fixture 断言）。
- **AC-W15 inject 过滤**：`GET .../messages` 默认不含 `kind=inject`。
- **AC-W17 多 scope 历史轨道**：同一 work 下 `draft` / `publish/<pubId>` / `resource/<rid>` 各 jsonl 互不混写；GET/run 按 scope（+id）定位；**ACP 绑定仍每作品一个**；同 work 仅换 scope 不得记 `switched_task`；换 scope 采用软隔离方案 A（声明 + 当前 scope 摘录）。
- **AC-W18 作品库**：`library.json` 可建嵌套文件夹并挂载 work；移动文件夹不改 work 实体目录名。
- **AC-W19 同作品单 flight**：同一 `task:work:<id>` 同时最多一个 in-flight run；第二请求 409 `work_busy` 或 UI 禁用（实现二选一，推荐入队前拒）。

### UI（详见 ui.md）

- **AC-U1～U7**：见 `ui.md` §10（含单 flight、scope 不触发 switched_task）。

## 非目标

- 平台级发布成品质检与账号后台自动化。
- PDF/Word/Excel 解析、跨 work 引用、版本自动 GC。
- delegateToolsSupport 硬隔离（与 017 同，另迭代）。
- UI 精修（动效、窄屏、拖拽库树等）；**MVP 交互以 `ui.md` 为准并验收 AC-U\***。
- `repairLibrary` 完整运维（已记任务后置，不挡主路径）。
- 每 scope 独立 ACP 会话（已否决）。

## 决策冻结摘要

| ID | 结论 |
|---|---|
| E1 | 预加载永不内联 content.md |
| E2 | URL 分析：note 短 + artifacts 长文 |
| E3 | dirty + 改正文：提示先存/丢弃（409），非无关能力一刀切 |
| E4 | conventions：包内默认 + userData 覆盖 |
| E5 | TaskKey：`task:<kind>:<id>` 统一池与锁 |
| 版本 | 用户手动保存进版本图 |
| 资源 | 一律 resources/；引用不做 |
| 草稿 | 仅 Markdown；发布阶段再适配平台 |
| publish | 允许 Agent 写（MVP 可后置完整能力） |
| branches 文件 | `drafts-branches.json` |
| 指针 | meta 权威 + branches 图；原子双写 |
| 历史 / ACP | 多 scope 历史轨道；**ACP 每作品一个**；发布历史每 pubId |
| scope 串话 | 软隔离方案 A（声明 + 摘录）；效果后续观察 |
| 同作品并发 | 单 flight |
