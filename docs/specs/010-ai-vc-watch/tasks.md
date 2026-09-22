# 010 — 任务

> 状态: **draft** —— 规格初版，等待用户评审（见 README「已确认决策（待用户评审）」四项）。评审通过后转 `implementing`，按 A→I 顺序实现。

## A. 数据管道

- [ ] A1 `scripts/fetch_vc.py` 骨架：复用 `fetch_market.py` 的进度协议 / 幂等 upsert / 退避重试结构
- [ ] A2 建表：`deal_event`（DDL 见 design 第三节），支持空库首次运行
- [ ] A3 `extract_techcrunch()` — RSS 解析（`xml.etree`），字段映射 guid/link/pubDate/title/description
- [ ] A4 `extract_hn()` — Algolia API 分页 + `numericFilters` 增量（首次回填近 90 天）
- [ ] A5 事件归一：`parseAmount` / `normalizeRound` / `classifySector` 由 Python 端调用（规则单一事实源 = `src/domain/vc.ts`，管道侧用同一份规则实现或读 JSON 常量，实现时定）
- [ ] A6 幂等写入 + `announced_at` 短路（源最新 ≤ 库内最新时 `[SKIP]`）
- [ ] A7 失败隔离：单来源 try/except，失败进 `failures` 不中断
- [ ] A8 `package.json` 新增 `fetch:vc` 脚本
- [ ] A9 实测：`npm run fetch:vc` 后 `data/vc.db` 有事件，幂等（连续两次行数一致，AC-D）

## B. 领域层 `src/domain/vc.ts`

- [ ] B1 类型：`Sector` / `DealEvent` / `DealEventView`
- [ ] B2 常量：`SECTOR_TAGS`（10 赛道关键词）、`CURRENCY_TO_USD` 汇率常量表、`ROUND_ALIASES` 轮次别名表
- [ ] B3 `parseAmount(text)` — $/€/£/¥ + 中文「亿元/万美元」，多金额取首个，失败 null
- [ ] B4 `normalizeRound(text)` — 中英文轮次归一，未知 null
- [ ] B5 `classifySector(text)` — 关键词命中取最高分，未命中 `unclassified`
- [ ] B6 `dealKey(source, sourceId)` / `monthKey(date)` / `toUsd()` / `formatUsd()` / `formatAmountCny()`
- [ ] B7 单测（design 第九节五个边界清单）

## C. 基础设施

- [ ] C1 `src/infrastructure/sqlite-vc-repository.ts` — 只读 + 写入打开 `data/vc.db`，`VC_DB_PATH` 覆盖
- [ ] C2 仓储方法：`loadDeals({sector,source,minUsd,limit,offset})` / `loadStats(by, filters)` / `insertManualDeal()` / `findByUrl()`
- [ ] C3 错误类型 `VcDataError`（库缺失 / 表缺失 / 空库三种上下文文案）
- [ ] C4 `src/infrastructure/vc-fetch-runner.ts` — 子进程 runner（复用 `fetch-runner.ts` 泛化模式）

## D. 用例层 `src/application/vc-service.ts`

- [ ] D1 `getDealFeed(filters)` — 倒序列表 + 统计摘要（总数/本月新增/近 90 天金额）
- [ ] D2 `getVcStats(by, filters)` — 赛道/月度聚合（金额只计 `amount_usd` 非空）
- [ ] D3 `createManualDeal(input)` — 校验（公司/日期必填、日期格式、金额、重复 URL 409）
- [ ] D4 `src/application/vc-fetch-service.ts` — 任务状态单例 + 409（结构对齐 `fetch-service.ts` / `market-fetch-service.ts`）

## E. API 路由

- [ ] E1 `GET /api/vc/deals`（sector / source / minUsd / limit / offset）
- [ ] E2 `GET /api/vc/stats`（by=sector|month，过滤联动）
- [ ] E3 `POST /api/vc/deals`（人工录入，400 / 409 / 201）
- [ ] E4 `POST /api/vc/fetch`（运行中 409）
- [ ] E5 `GET /api/vc/fetch/status`

## F. 表现层

- [ ] F1 `src/app/(vc)/layout.tsx` — Topbar「AI 创投观察」+ SectionTabs + VcFetchButton
- [ ] F2 `/ai-vc` 事件流页：统计摘要 + 过滤控件（赛道/来源/大额）+ 分页列表
- [ ] F3 `src/components/vc/deal-table.tsx` — 事件行（日期/公司/轮次/金额/赛道/来源徽标/链接）
- [ ] F4 `src/components/vc/deal-form.tsx` — 人工录入表单（字段校验 + 409 重复提示）
- [ ] F5 `/ai-vc/analytics` 分析页：赛道分布（计数/金额切换）+ 月度趋势（柱+线双轴）
- [ ] F6 `src/components/vc/sector-chart.tsx` / `monthly-trend.tsx` — ECharts 惰性初始化（009 I4 教训）
- [ ] F7 `src/components/vc/vc-fetch-button.tsx` — 进度条 + 防重复（复用 spec 003 交互）
- [ ] F8 `src/components/vc/freshness-hint.tsx` — 最新事件日期 / 抓取时间 / 滞后警示 + 数据覆盖说明
- [ ] F9 两个页面各配 `error.tsx` 兜底
- [ ] F10 侧边栏新增一级「AI 创投观察」（`match` 两项路径 + 新图标）
- [ ] F11 首页新增「AI 创投观察」模块卡片（事件总数 + 最新日期）

## G. 测试

- [ ] G1 `src/domain/vc.test.ts` — `parseAmount` 全币种/中文/未披露/多金额取首
- [ ] G2 `normalizeRound` 中英文轮次 / `classifySector` 全赛道 + 未命中不抛错
- [ ] G3 `toUsd` 支持/不支持币种 / `formatUsd` 边界（null / M / B）
- [ ] G4 `src/application/vc-service.test.ts` — 真实 SQLite fixture（`VC_DB_PATH` → `os.tmpdir()`）
- [ ] G5 集成覆盖：事件流倒序/过滤/分页、stats 聚合（未披露不计金额）、人工录入校验（非法日期/空公司/未来日期/重复 URL 409）、空库降级

## H. 文档同步

- [ ] H1 `docs/conventions.md` — 术语表新增 `DealEvent` / `融资事件` / `赛道` 等；新增「创投数据口径」小节
- [ ] H2 `docs/conventions.md` — 信息架构小节补充「AI 创投观察」板块
- [ ] H3 `docs/README.md` — 规格索引补 010
- [ ] H4 根 `README.md` — 运行说明补 `npm run fetch:vc` 与板块说明

## I. 验证

- [ ] I1 `npm test` 全绿（新增 domain + application 用例）
- [ ] I2 `next build` 通过
- [ ] I3 两页 `curl` 全 200（AC-C）
- [ ] I4 目检：事件流过滤/分页正确、金额格式与未披露文案、来源徽标、图表空态占位
- [ ] I5 抓取实测：`npm run fetch:vc` → `data/vc.db` 有事件且 `latest_date` 合理（AC-D）
- [ ] I6 幂等验证：连续执行两次，`deal_event` 行数与内容一致（US-3 AC4）
- [ ] I7 人工录入实测：合法提交 → 201 且列表可见；非法提交 → 字段级 400（AC-E）

## 变更记录

- 2026-09-22: 初版（draft）。数据源结论基于本机实测；四项待决事项见 README。评审通过后转 implementing。
