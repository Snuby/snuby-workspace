# Snuby — SDD 工作流说明

Snuby 采用 **SDD（Spec-Driven Development, 规格驱动开发）**：每个功能先写规格（Spec），规格评审通过后再实现，实现必须与规格保持一致，代码变更必须回写规格。

## 目录结构

```
docs/
├── README.md              # 本文件：SDD 流程与规则
├── conventions.md         # 全局编码与架构规范（所有 spec 必须遵守）
├── design-system.md       # 全局视觉规范（创作者专业台 token / 交互同构）
├── acp-gateway-capability.md  # ACP 网关能力备忘
└── specs/
    └── NNN-<slug>/        # 每个 spec 一个目录, 编号递增
        ├── README.md        # 概要: 状态 + 目标 + 非目标
        ├── requirements.md  # 需求: 用户故事 + 验收标准
        ├── design.md        # 设计: 架构决策 + 数据流 + 接口契约
        └── tasks.md         # 任务: 拆解步骤 + 状态跟踪
```

## 规格生命周期

```
draft → reviewed → implementing → done
```

1. **draft**: 提出需求，写 `requirements.md`（用户故事 + 可验证的验收标准）。
2. **reviewed**: 确认范围与验收标准后冻结，方可进入设计与实现。
3. **implementing**: 按 `tasks.md` 逐项实现并勾选；发现与规格冲突时，先改规格再改代码。
4. **done**: 全部验收标准满足、`next build` 通过后关闭。后续变更走新 spec 或在原 spec 追加变更记录。

## 一致性规则（强制）

1. **单一事实源**: 需求以 `requirements.md` 为准，技术决策以 `design.md` 为准，**视觉以 `design-system.md` + `globals.css` 为准**。代码与文档冲突 = Bug，必须同步修复其中之一。
2. **术语一致**: 文档与代码使用同一套领域术语（见 `conventions.md` 术语表）。
3. **接口契约**: API 路由的请求/响应结构必须在对应 `design.md` 中定义，代码注释引用 spec 编号（如 `// Spec: 017-agent-session`）。
4. **任务可追溯**: `tasks.md` 中的每项任务对应一次可验证的提交，状态只允许 `[ ]` / `[x]` / `[-]`（取消）。
5. **目录齐备**: 每个 spec 目录必须包含 `README.md` / `requirements.md` / `design.md` / `tasks.md` 四个文件（轻量 spec 的 design 可并入 README，但需在 README 中说明）；缺文件视为规格不完整。
6. **测试即规格**: 契约类逻辑必须有对应单测，改契约需先改 spec。
7. **视觉变更**: 改色板 / 选中态 / 圆角 / 壳层密度时，先更新 `docs/design-system.md` 与 token，再改组件；新 UI 不得硬编码强调色 hex。

## 当前规格索引

| 编号 | 名称 | 状态 |
|------|------|------|
| 011 | ai-leaderboard（AI 模型榜单板块） | done |
| 012 | electron-packaging（Snuby 工作台桌面版） | done |
| 013 | webview-embeds（榜单 webview 内嵌） | done |
| 014 | embed-hosts-config（内嵌站主机配置） | done |
| 016 | nav-modules（导航与主题模块） | done |
| 017 | agent-session（本地 Agent 多会话） | done |

> 历史规格 001–009（宏观经济 / 资产行情及相关抓取与测试）已随模块下线移除，不再维护。
