# 009 — market-quotes（资产行情 K 线与跨资产归一化对比）

状态: **done**（2026-09-22 实现、验证与文档同步完成后关闭）

## 目标

新增工作台第二个一级板块「资产行情」：

1. **单资产 K 线**：以蜡烛图展示 11 个关键资产的走势，支持**日 / 周 / 月 / 年**四种粒度切换。
2. **跨资产归一化合并图**（本板块最重要的一张图）：把量级相差数个数量级的资产折算到同一基准（起点 = 100），使「黄金 vs 比特币 vs 上证 vs 房价」的相对强弱可以在同一根 Y 轴上直接比较。

## 资产清单（6 类 11 项，用户指定）

| # | 类别 | 资产 | symbol | 单位 |
|---|------|------|--------|------|
| 1 | 贵金属 | 黄金、白银 | `gold` `silver` | 美元/盎司 |
| 2 | 加密货币 | 比特币、以太坊、狗狗币 | `btc` `eth` `doge` | USDT |
| 3 | 美股 | 道琼斯、纳斯达克 | `dji` `ixic` | 点 |
| 4 | 中国香港股 | 恒生指数 | `hsi` | 点 |
| 5 | A 股 | 上证指数 | `sse` | 点 |
| 6 | 房产 | 北京、上海 | `bj_house` `sh_house` | 价格指数 |

## 为什么需要归一化

11 个资产的原始量级跨越 6 个数量级 —— 狗狗币 0.0991 USDT、北京房价指数 192.7、上证 3952、比特币 85331。直接叠在一张图上，狗狗币会贴死在 X 轴。归一化后统一为「相对基准日的百分比涨幅」，**图上的距离 = 相对表现差异**，这才回答了用户「直观看出不同资产走势」的诉求。

## 非目标

- **不做实时行情**（用户明确「不需要实时」）：无 WebSocket、无盘中推送、无自动轮询定时器。抓取由页面按钮手动触发，沿用 spec 003 的交互模型。
- 不做分时图 / 分钟级 K 线。
- 不做技术指标（MA / MACD / KDJ / BOLL）与画线工具 —— 本期只解决「看得见走势 + 比得清强弱」。
- 不做自选资产 / 用户自定义清单（资产表写在代码常量，与 spec 002 告警规则同理）。
- 不改动 `data/china_economy.db`、宏观板块（spec 001–008）的任何行为与契约。

## 依赖与复用

| 复用对象 | 来源 | 用途 |
|---|---|---|
| 子进程进度协议（`@@PROGRESS` / `@@DONE`） | spec 003 | 行情抓取同样需要进度可见 |
| 内存单例任务状态 + 409 防重复 | spec 003 | 抓取期间禁止重复触发 |
| 路由组 + 共享 layout 层级模式 | spec 008 | `(market)/` 与 `(macro)/` 同构 |
| `SectionTabs` 二级菜单 | spec 008 | 直接复用，追加 `accent` 参数即可 |
| 测试分层（domain 单测 / application 集成） | spec 006 / 007 | 聚合与归一化是纯函数，优先覆盖 |
| 时效判定思路 `STALE_LAG_MONTHS` | spec 004 | 行情用「交易日数」口径另立阈值 |

## 交付物（规划）

**数据层**
- `scripts/fetch_market.py` — 行情抓取管道（新增）
- `data/market.db` — 独立 SQLite 库（运行时生成）

**领域层**
- `src/domain/market.ts` — 资产常量表、`Candle` / `Period` 类型、`aggregate()` / `normalize()` / `alignSeries()` 纯函数
- `src/domain/market.test.ts` — 单测

**用例层**
- `src/application/market-service.ts` — `getMarketOverview()` / `getAssetSeries()` / `getComparison()`
- `src/application/market-service.test.ts` — 集成测试

**基础设施**
- `src/infrastructure/sqlite-market-repository.ts` — 只读仓储
- `src/infrastructure/market-fetch-runner.ts` — 子进程runner（泛化自 `fetch-runner.ts`）

**表现层**
- `src/app/(market)/layout.tsx` + 5 个子页
- `src/components/market/` 下 5 个组件
- `src/app/api/market/` 下 4 条路由

## 已确认决策（2026-09-22）

| 议题 | 决定 | 影响 |
|---|---|---|
| 二级菜单划分 | **5 项**：综合对比 / 贵金属 / 加密货币 / 股票指数 / 房产 | 四个指数合为一页做四线对比，不按市场拆三页 |
| 金银价格口径 | **COMEX 期货，美元/盎司** | OHLC 完整可画标准蜡烛图；上海金交所保留为备选源（design 1.3） |
| 存储位置 | **独立库 `data/market.db`** | 与宏观库失败隔离，抓取节奏各自独立 |

## 变更记录

- 2026-09-22: 初版设计（draft）。数据源结论基于本机实测（akshare 1.18.96），排除 8 个候选源并记录理由。
- 2026-09-22: 用户确认三项决策（上表），转 `implementing`。
