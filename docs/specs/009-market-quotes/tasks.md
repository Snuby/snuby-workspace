# 009 — 任务

> 状态: **implementing** —— 三项待决事项已于 2026-09-22 确认（见 design 第十节），按 A→I 顺序实现。

## A. 数据管道

- [x] A1 `scripts/fetch_market.py` 骨架：复用 `fetch_data.py` 的进度协议 / `clean()` / 幂等 upsert 结构，抽出共用工具避免复制粘贴
- [x] A2 建表：`asset` / `kline`（DDL 见 design 第三节），支持空库首次运行
- [x] A3 除权资产抓取：`gold` `silver`（`futures_foreign_hist`，丢弃恒为 0 的 volume 列）
- [x] A4 加密资产抓取：`btc` `eth` `doge`（Binance klines + `endTime` 分页至最早，毫秒时间戳转 `YYYY-MM-DD`）
- [x] A5 指数资产抓取：`dji` `ixic`（新浪美股）、`hsi`（东财，注意 `latest` → `close` 重命名）、`sse`（东财）
- [x] A6 房价派生：`bj_house` `sh_house`，环比指数连乘构造水平序列（design 决策 1.4），写入 `note` 口径说明
- [x] A7 `asset` 表写入：`precision` / `has_ohlc` / `has_volume` / `base_freq` / `note` 随抓取刷新
- [x] A8 增量短路：源最新日期 ≤ 库中 `last_date` 时跳过写入（design 决策 8 第二层）
- [x] A9 失败隔离：单资产 try/except，失败进 `failures` 不中断；`@EXCLUDE_CATEGORIES` 降级开关
- [x] A10 `package.json` 新增 `fetch:market` 脚本
- [x] A11 实测：11 个资产全部入库，`last_date` 满足 AC-D

## B. 领域层 `src/domain/market.ts`

- [x] B1 资产常量表 `MARKET_ASSETS`（11 项：symbol/name/category/unit/precision/…）
- [x] B2 类别常量 `ASSET_CATEGORIES`（6 类：metal/crypto/us/hk/cn/realestate）
- [x] B3 类型：`Period` / `Range` / `Candle` / `AssetMeta` / `AssetStat`
- [x] B4 `aggregate(rows, period)` — 四档粒度，OHLC 首开/最高/最低/末收/量求和
- [x] B5 周界计算 — 分组键取**所在周周一日期**，保证跨年周不切断
- [x] B6 `normalize(rows, baseDate?)` — 基准点恒 100；基准早于首点时取首点；基准为 0 返回 `null` 不返回 `Infinity`
- [x] B7 `alignSeries(seriesMap)` — 日期并集升序 + 前向填充 + 首点前 `null`
- [x] B8 `sliceRange(rows, range)` — 窗口裁剪，以最后一条数据日期为锚点
- [x] B9 滞后判定 `isMarketStale(lastDate, baseFreq)` — 日频按自然日（5 天）、月频按月（45 天）
- [x] B10 格式化辅助 `formatPrice(value, precision)` — 读 `precision`，不做全局取整

## C. 基础设施

- [x] C1 `src/infrastructure/sqlite-market-repository.ts` — 只读打开 `data/market.db`，`MARKET_DB_PATH` 覆盖
- [x] C2 仓储方法：`loadAssets()` / `loadKline(symbol)` / `loadKlineBatch(symbols)` / `resolveDbPath()`
- [x] C3 错误类型 `MarketDataError`（库缺失 / 表缺失 / 空库三种上下文文案）
- [x] C4 `src/infrastructure/market-fetch-runner.ts` — 子进程 runner，可泛化自 `fetch-runner.ts`（脚本路径参数化）

## D. 用例层 `src/application/market-service.ts`

- [x] D1 `getMarketOverview()` — 11 资产统计（最新价 / 日涨跌 / 区间涨跌 / 滞后 / 精度）
- [x] D2 `getAssetSeries(symbol, period, range)` — 单资产 K 线（读全量 → 裁剪 → 聚合）
- [x] D3 `getComparison(symbols, period, range, baseDate?)` — 归一化 + 对齐，回传各资产实际基准日 `bases`
- [x] D4 客户端聚合支持：暴露纯聚合供前端粒度切换复用（不重新读库）
- [x] D5 `src/application/market-fetch-service.ts` — 任务状态单例 + 409（结构对齐 `fetch-service.ts`）

## E. API 路由

- [x] E1 `GET /api/market/assets`
- [x] E2 `GET /api/market/kline`
- [x] E3 `GET /api/market/compare`
- [x] E4 `POST /api/market/fetch`（运行中 409）
- [x] E5 `GET /api/market/fetch/status`

## F. 表现层

- [x] F1 `src/app/(market)/layout.tsx` — Topbar「资产行情」+ SectionTabs + MarketFetchButton
- [x] F2 `SectionTabs` 扩展为接收 `tabs` / `action` 参数（默认值保持 spec 008 行为不变）
- [x] F3 `src/components/market/period-switcher.tsx` — 粒度（日/周/月/年）+ 窗口（1Y/3Y/5Y/ALL），支持 `disabledPeriods`
- [x] F4 `src/components/market/kline-chart.tsx` — 蜡烛图（`[open,close,low,high]` 顺序）+ 量副图 + dataZoom + 折线降级
- [x] F5 `src/components/market/normalized-chart.tsx` — 归一化多曲线（分类色板 / `connectNulls:false` / 图例切换）
- [x] F6 `src/components/market/asset-picker.tsx` — 勾选器（1–11 个约束，默认 5 个代表资产）
- [x] F7 `src/components/market/asset-card.tsx` — 资产卡（最新价 / 涨跌 / 精度 / 滞后 / 口径说明）
- [x] F8 `src/components/market/market-fetch-button.tsx` — 进度条 + 防重复（复用 spec 003 交互模式）
- [x] F9 `/market` 综合对比页（首屏合并图 + 11 张资产卡）
- [x] F10 `/metal` `/crypto` `/equity` `/realestate` 四个分类页
- [x] F11 五个页面各配 `error.tsx` 兜底
- [x] F12 `globals.css` 新增 token：`--color-up` / `--color-down` / `-soft`（红涨绿跌，design 决策 9）
- [x] F13 侧边栏新增一级「资产行情」（`match` 五项路径）
- [x] F14 首页新增「资产行情」卡片

## G. 测试

- [x] G1 `src/domain/market.test.ts` — 聚合四档粒度 OHLC 取法
- [x] G2 周界跨年不切断（2025-12-29 ~ 2026-01-04 同周）
- [x] G3 `normalize` 起点恒 100 / 基准早于首点 / 基准为 0 三个边界
- [x] G4 `alignSeries` 并集 / 前向填充 / 首点前 `null`
- [x] G5 聚合量的 null 传播（不把 null 当 0）
- [x] G6 月频资产 `aggregate(rows, "D")` 原样返回
- [x] G7 `src/application/market-service.test.ts` — 真实 SQLite fixture 集成（`MARKET_DB_PATH` 指向 `os.tmpdir()`）
- [x] G8 集成覆盖：资产统计 / 滞后判定 / 精度透传 / K 线读取聚合 / `bases` 回传 / 空库降级

## H. 文档同步

- [x] H1 `docs/conventions.md` — 术语表新增 `Candle` / `Period` / `归一化基准` / `资产` 等；新增「行情数据口径」小节
- [x] H2 `docs/conventions.md` — 信息架构小节补充「资产行情」板块
- [x] H3 `docs/README.md` — 规格索引补 009
- [x] H4 根 `README.md` — 运行说明补 `npm run fetch:market`
- [x] H5 spec 008 追加变更记录（`SectionTabs` 参数化）

## I. 验证

- [x] I1 `npm test` 全绿（新增 domain + application 用例）
- [x] I2 `next build` 通过
- [x] I3 五页 `curl` 全 200（AC-C）
- [x] I4 目检：K 线蜡烛正确、红涨绿跌、量副图、降级折线、合并图归一化与图例交互
- [x] I5 抓取实测：`npm run fetch:market` → 11 资产 `last_date` 达标（AC-D）
- [x] I6 幂等验证：连续执行两次，`kline` 行数与内容一致（US-5 AC4）

## 变更记录

- 2026-09-22: 初版（draft）。数据源结论基于本机实测（akshare 1.18.96），已排除 8 个候选源并记录理由。待确认：二级菜单划分、金银口径、存储方案。
- 2026-09-22: 状态 implementing → done。I4 目检发现并修复 ECharts 图表初始化 bug（首帧空数据走早退分支导致初始化 effect 空跑、数据到达后图表永久空白），`KLineChart` / `NormalizedChart` 改为惰性初始化；坑已沉淀至 conventions「行情数据口径」。
- 2026-09-22: 数据源加固 —— 东财 push2 间歇性不可达实测暴露单源脆弱性，`fetch_market.py` 加提取器重试（3 次退避）+ hsi/sse 新浪备用源自动降级，降级路径实测 11/11 SKIP 0 失败。
- 2026-09-22: `MarketFetchButton` 布局修复（用户反馈「上次抓取」文案与按钮挤在一起）—— 46px 导航条内改单行布局，摘要放按钮左侧、进度条内联、失败明细收进 hover 提示；宏观 `FetchButton` 同缺陷同步修复（记录见 spec 003）。
