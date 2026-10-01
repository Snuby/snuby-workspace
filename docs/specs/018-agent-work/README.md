# Spec 018 — 作品创作（Agent Work / AI 氛围式创作）

状态：implementing（MVP 主路径已通：领域 API + run + 创作页骨架）

## 背景与问题

创作中心需要「作品创作」模块：把一篇（组）面向公众号 / 小红书 / 头条等平台的内容，在**创作全生命周期**内与 AI 协作完成。本地 Agent（spec 017）提供了会话隔离与 ACP 执行经验，但：

1. 会话是通用任务空间，缺少作品领域模型（素材、多版草稿、发布快照、版本分叉）。
2. 注入文案大量硬编码在 `buildSessionSetupText`，作品侧需要**可审计、文件化、渐进披露**的上下文规范。
3. 若作品再抄一套锁/队列/align，会与 017 **双轨漂移**；若直接复用会话 store/activate，领域会缠死。

## 目标

1. 建立聚合根 **Work（agent-work）**：一作品一目录，收敛素材、草稿版本图、AI 协作历史、中间产物、发布快照。
2. 提炼 **AgentRuntime**：全局锁 / 队列 / align / inject / audit 与 TaskKind 解耦；Work 与 LocalSession 均为 Provider 插件。
3. 作品侧 **独立实现** 领域与 ContextProvider（不调用 `agent-session-store` / `activateLocalSession`）；执行基建与会话共享。
4. 注入少硬编码：包内 conventions + userData 覆盖；L0/L1/L2 渐进披露；全量必含 meta 等事实文件；**永不内联** `content.md` 正文。
5. 宿主强制写权限（capability × 路径 × dirty），不以提示词当权限。

## 核心决策（详见 design.md）

1. **作品 = 类会话的逻辑任务**，磁盘在 `agent-works/<workId>/`；文章草稿唯一形态为 Markdown。
2. **AgentRuntime 公共**；`TaskKey = task:<kind>:<id>`；全局禁止并行（跨 kind 互斥）。
3. **LocalSession 后迁**到同一 Runtime（W4）；MVP 先 W0 行为等价封装 + W1–W3 作品挂接。
4. 版本：用户手动保存；有 diff 才新节点；checkout 只改指针；meta 权威指针 + `drafts-branches.json` 图，原子双写。
5. dirty 时禁止 Agent 写当前 `content.md`；`edit-draft` 入口 409 + path-policy deny。
6. 资源一律 `resources/` + `resources.json`（revision）；url 可分析 → note 短结论 + artifacts 长文；一期白名单（url/文本/图片）。
7. 跨 work 资源引用：**不做**（本 spec）。
8. UI 交互细设后置；本 spec 先钉底层与 API。

## 非目标（MVP）

- 完整多平台发布成片与后台联调。
- PDF/Office 深度解析、版本 GC、硬隔离（delegateTools）、conventions 设置页。
- 跨作品资源引用。
- 精修作品创作 UI（可先 API/目录/跑通能力）。

## 交付物（实现期）

- `src/infrastructure/agent-runtime/` — 队列、marker、align、inject、run、audit、conventions
- `src/infrastructure/agent-work/` — store / draft / resource / path-policy / provider / library
- `src/app/api/work/**` — 作品领域 API
- 包内 `agent-conventions/work/*` — runtime.md 等
- 本目录：README / requirements / design / tasks / **ui.md**

## 关联

- Spec 017 — AgentSession（隔离矩阵、操作边界、ACP 物理定律）
- `docs/acp-gateway-capability.md` — 网关事实源
- 本目录 `ui.md` — 创作主界面与多 scope Agent 交互；含对底层的修订（library + collab 消息）

## 变更记录

- 2026-10-01：文档债治理；scope 软隔离 A、单 flight、PROTECTED、repair 后置；状态 implementing，开工 W0。
- 2026-10-01：发布历史按 pubId 拆分；澄清 scope≠ACP 会话（见 ui.md §6、design §3.2）。
- 2026-10-01：新增 `ui.md`；底层需增作品库索引与 `collab/` 多 scope 消息（见 ui.md §8）。
- 2026-10-01：设计 v0.1–v0.6 收束落盘（四件套）；状态 designed，未开工。
