# 011 — 设计

> 状态: **implementing**。轻量 spec，design 决策已并入 README；本文件只记录代理实现的精确契约与数据结构。

## 数据流

```
/ai-leaderboard              /ai-leaderboard/openrouter
   ↓ iframe 直连                 ↓ 服务端 fetch (no-store)
artificialanalysis.ai      openrouter.ai/api/frontend/v1/rankings/models?view=week
                                ↓ aggregateRankings() 纯函数
                           rows(rank/slug/name/tokens) + updatedAt
                                ↓ OpenRouterBoard (client) 渲染
                           ECharts 横向柱 Top 15 + 表格 Top 50 + 官方直链
```

- 服务端 fetch 带浏览器 UA + referer；`cache: "no-store"` 保证实时；失败 → 页面错误态 + 官方直链。
- 聚合口径: tokens = completion + prompt（`total_completion_tokens + total_prompt_tokens`），按 `model_permaslug` 求和（忽略 variant/日期重复），降序赋 rank；updatedAt = 数据最大日期（YYYY-MM-DD）。
- 展示名: `shortModelName(slug)` —— "deepseek/deepseek-v4-flash-20260731" → "deepseek/v4-flash"（去日期后缀、去重复厂商前缀）。
- 数字格式: `formatTokens` —— T/B/M 1 位小数（18.4T / 6.4B / 912.1M）。

## or-rankings domain 契约

- `OrRankingInput` = `{ date, model_permaslug, total_completion_tokens, total_prompt_tokens }`（API data 行子集）。
- `aggregateRankings(rows): { rows: OrRankingRow[]; updatedAt: string | null }`
- `OrRankingRow` = `{ rank, slug, name, tokens }`
- `shortModelName(slug): string`、`formatTokens(n): string` —— 均有单测（spec 006）。

## 图表与表格

- ECharts 横向柱状图 Top 15（长类目优先横向；`inverse: true` 使第一名在上），x 轴 label 与 bar label 用 `formatTokens`。
- 表格列: 排名（前三名金银铜色）/ 模型名 / 周 tokens，Top 50 行。
- 空态: 无数据或 fetch 失败 → 错误提示 + 官方直链。

## 页面组件

- `src/components/leaderboard/leaderboard-frame.tsx`（"use client"）:
  - props: `{ src: string; title: string; externalUrl: string }`
  - 结构: 来源说明条（来源链接「在新窗口打开」）+ `<iframe src title className="h-full w-full border-0" />` 包在 `h-full` 容器内。
- `src/app/(leaderboard)/layout.tsx`: Topbar「AI 模型榜单」+ SectionTabs（`/ai-leaderboard`「Artificial Analysis」、`/ai-leaderboard/openrouter`「OpenRouter 排名」）+ 滚动容器。

## 侧边栏与首页

- sidebar: 一级菜单「AI 模型榜单」，path `/ai-leaderboard`，新图标（榜单/柱状图样式），match 路径 `[/ai-leaderboard, /ai-leaderboard/openrouter]`。
- 首页: 「AI 模型榜单」模块卡片（纯链接，无数据库依赖）。
