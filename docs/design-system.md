# Snuby 设计系统 — 创作者专业台

> **单一事实源（视觉）**。改色板 / 圆角 / 选中态 / 动效强度时，先改本文与 `src/app/globals.css`，再改组件；禁止模块私自另起强调色或阴影体系。  
> 方向：方案 B · 创作者专业台（2026-09-29 选定）。参考 Taste Skill（反模板）+ redesign 审计思路，面向**桌面工作台产品 UI**（非落地页）。

## Design Read

Snuby 工作台 · 自媒体创作者与本地 Agent 协作 · Linear / Arc 式冷静专业工具 · 冷灰底 + 钢蓝强调 · 高信息密度、低装饰。

## 三旋钮

| 旋钮 | 值 | 含义 |
|------|----|------|
| DESIGN_VARIANCE | 3 | 结构稳定，少实验布局 |
| MOTION_INTENSITY | 3 | 仅 hover / 选中 / 面板切换淡入 |
| VISUAL_DENSITY | 7 | 侧栏紧、标签扁、留白克制 |

## Token（`src/app/globals.css` `@theme`）

| Token | 值 | 用途 |
|-------|-----|------|
| `page` | `#F2F3F5` | 窗体底 |
| `surface` | `#FFFFFF` | 面板 / 激活标签 / webview 外框 |
| `surface-2` | `#EBEDF0` | 侧栏、标签轨道、次级条 |
| `ink` | `#1C1F24` | 主文字 |
| `ink-muted` | `#5C6370` | 次级文字 |
| `ink-faint` | `#8B929E` | 提示 / 分组标题 |
| `line` | `rgba(28,31,36,0.10)` | 分割线 |
| `hover` | `rgba(28,31,36,0.05)` | 悬停底 |
| `accent` | `#1F6FEB` | 主操作 / 选中 |
| `accent-soft` | `#E8F1FE` | 选中底 |
| `accent-deep` | `#1150B0` | 强调字 |
| `up` / `down` | 红涨绿跌（既有语义） | 仅数据涨跌，不作装饰强调色 |

**禁止**：紫渐变、大面积玻璃、暖奶油底、整页暗黑、多模块多强调色。

## 字体

- 栈：`-apple-system, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif`
- 字阶：侧栏 13 / 标签 12.5 / 正文 13–14 / 壳层标题 14–15 semibold
- 字重：regular + medium/semibold；不用细字重堆层次

## 几何

| 用途 | 值 |
|------|----|
| 控件圆角 | `6px`（`rounded-[6px]`） |
| 标签顶圆角 | `7px` |
| 弹层 / 面板 | `8px` |
| 主内容壳 | `12px`（`--radius-shell`；相对窗体底浮起，四角裁切） |
| 侧栏宽 | `228px` |
| 顶栏高 | `40–42px` |
| 标签栏高 | `36–38px` |
| 图标钮 | `28×28` |
| 间距刻度 | `4 / 8 / 12 / 16` |

## 交互同构（全模块）

1. **选中**：`bg-accent-soft` + `text-accent-deep`（侧栏项、矩阵账号 chip、同类列表）
2. **标签激活**：底线 `accent` + `text-accent-deep`（站点选项卡、站内页签、矩阵账号共用；圆角壳内不再用 Chrome 浮起页签）
3. **悬停**：`bg-hover`；图标钮同
4. **危险**：仅删除 / 失败用红，不进主色
5. **加载**：标签脉冲点 + 首屏「加载中」+ 失败「重试」（主题 SiteBrowser 与矩阵共用语义）
6. **动效**：`150–200ms` 的颜色/透明度；禁止弹跳、磁吸、滚动视差
7. **窗体**：macOS `titleBarStyle: hiddenInset`；仅侧栏顶部 `app-drag`（红绿灯旁空白可拖）；内容区不设 drag，优先保证可交互

## 模块映射

| 区域 | 约定 |
|------|------|
| 侧栏 | 与窗体底同色 `page`；分组标题 `ink-faint`；激活项 accent 规则 |
| 主内容壳 | `my-2 mr-2` + `rounded-[var(--radius-shell)]` + `border-line` + `bg-surface`；`overflow-hidden` 裁切 webview |
| 顶栏 / 矩阵账号条 | 标题左内边距统一 `px-4`；chip 同侧栏选中；`+添加` 实心 accent |
| 标签栏 | `surface-2` 轨道 + `surface` 激活页签；关闭钮预留位 + hover 显隐 |
| 首页氛围 | 问候 + 大号电子钟 + 农历/休班月历 + 天气；不做功能入口卡；休用 `up` 角标 |
| Agent / 设置 | 表单与按钮套同一 token，禁止另起灰蓝 |

## 与方案 A 的差异（备忘）

| | A 精修工作台 | B 创作者专业台（当前） |
|--|--------------|------------------------|
| 底色 | 暖浅 `#F6F5F0` | 冷灰 `#F2F3F5` |
| 强调 | 经典蓝 `#185FA5` | 钢蓝 `#1F6FEB` |
| 气质 | 在原壳上收紧 | 更「专业工具箱」 |

## 变更流程

1. 先更新本文与 `globals.css`
2. 再改消费 token 的组件（优先壳层：sidebar / topbar / site-browser / matrix）
3. 新 UI 不得硬编码强调色 hex（涨跌色与既有例外除外）；新增语义色须先入本文

## 相关

- 编码规范：`docs/conventions.md`（样式层指向本文）
- Taste Skill（参考）：`.cursor/skills/design-taste-frontend/`、`.cursor/skills/redesign-taste/`
