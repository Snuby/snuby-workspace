# Spec 018 — 任务（作品创作 / Agent Work）

状态图例：`[x]` 完成 · `[ ]` 未开始 · `[~]` 进行中

当前总状态：**implementing（MVP 主路径已通）**

## 文档

- `[x]` #018-D1～D3 设计与文档债
- `[~]` #018-D4 conventions 全文文件化（现由 work-preload 内联 L0；草案见 conventions-runtime-draft.md）

## W0 — Runtime

- `[x]` #018-01/#018-02 类型 + TaskKey + AlignReason
- `[~]` #018-03/#018-04 作品 run 直接调 workbuddy-acp；会话侧全量 TaskKey 迁移仍可后置

## W1 — Preload / policy

- `[x]` #018-11/#018-12 work-preload + context-state
- `[x]` #018-13 path-policy 模块 + 单测（permission 回调挂载可随会话回迁加深）
- `[x]` #018-14 preload 无正文 / policy 单测

## W2 — 领域与 API

- `[x]` #018-20 WorkRepository + `/api/work`
- `[x]` #018-20b library API `/api/work/library`
- `[ ]` #018-20c repairLibrary 后置
- `[x]` #018-21 DraftService + draft/checkout/branches API
- `[x]` #018-22 ResourceService + resources API
- `[x]` #018-22b CollabMessageStore + messages API
- `[x]` #018-23 run / audit API；同作品 busy 409
- `[x]` #018-24 单测覆盖核心 AC

## W3 — 执行

- `[x]` #018-30 run NDJSON + 预加载 + 单 flight
- `[x]` #018-31 messages / audit
- `[x]` #018-32 analyze-url note 钩子（note-patch / 回复截断）
- `[x]` #018-33 work-audit
- `[~]` #018-34 排队文案（aheadKey；标题解析可增强）
- `[x]` #018-35 自动化单测 + 创作页可手工验

## UI

- `[x]` 创作页 MVP：作品条/库树预览切换、新建、稿件三栏、资源壳、稿件 Agent、保存/版本树
- `[~]` 发布视图仅占位（publish-prepare 后置）

## 后置

- repairLibrary、publish 完整 UI、permission 深度挂 path-policy、会话 Runtime 回迁、conventions 文件加载器

## 验证记录

- 2026-10-01：MVP 落地；`npm test` 39 全绿；`tsc --noEmit` 通过。
