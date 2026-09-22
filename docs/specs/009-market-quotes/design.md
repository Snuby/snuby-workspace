# 009 — 设计

> 本文档所有数据源结论均为 **2026-09-22 在本机实测**（akshare 1.18.96 + Python 3.13.12），非文档推断。接口行为会随上游变化，实现阶段须以实测为准。

---

## 一、数据源（实测）

### 1.1 选型结果

| symbol | 资产 | 类别 | 源 | 调用 | 起始 | 实测最新 | OHLC | 量 |
|---|---|---|---|---|---|---|---|---|
| `gold` | 黄金 | metal | COMEX 期货 | `ak.futures_foreign_hist("GC")` | 2016-09-22 | 2026-09-22 | ✅ | ❌ |
| `silver` | 白银 | metal | COMEX 期货 | `ak.futures_foreign_hist("SI")` | 2016-09-22 | 2026-09-22 | ✅ | ❌ |
| `btc` | 比特币 | crypto | Binance | `GET /api/v3/klines?symbol=BTCUSDT&interval=1d` | 2017-08-17 | 2026-09-22 | ✅ | ✅ |
| `eth` | 以太坊 | crypto | Binance | `…symbol=ETHUSDT…` | — | 2026-09-22 | ✅ | ✅ |
| `doge` | 狗狗币 | crypto | Binance | `…symbol=DOGEUSDT…` | — | 2026-09-22 | ✅ | ✅ |
| `dji` | 道琼斯 | us | 新浪美股 | `ak.index_us_stock_sina(".DJI")` | 2004-01-02 | 2026-09-21 | ✅ | ✅ |
| `ixic` | 纳斯达克 | us | 新浪美股 | `ak.index_us_stock_sina(".IXIC")` | 2004-01-02 | 2026-09-21 | ✅ | ✅ |
| `hsi` | 恒生指数 | hk | 东财港股 | `ak.stock_hk_index_daily_em("HSI")` | 1990-05-14 | 2026-09-22 | ✅ | ❌ |
| `sse` | 上证指数 | cn | 东财指数 | `ak.stock_zh_index_daily_em("sh000001")` | 1990-12-19 | 2026-09-22 | ✅ | ✅ |
| `bj_house` | 北京房价 | realestate | 统计局 70 城 | `ak.macro_china_new_house_price()` 派生 | 2011-01 | 2026-08 | ❌ | ❌ |
| `sh_house` | 上海房价 | realestate | 统计局 70 城 | 同上 | 2011-01 | 2026-08 | ❌ | ❌ |

**数据量估算**：合计 ≈ 44,000 行 × 约 60 字节 ≈ **2.6 MB**。全量抓取实测约 30–60 秒（其中东财港股接口约 4 秒、Binance 分页 5 次约 3 秒）。

### 1.2 各源字段映射

```
futures_foreign_hist   → date, open, high, low, close   (volume/position/settlement 恒为 0，丢弃)
index_us_stock_sina    → date, open, high, low, close, volume
stock_zh_index_daily_em→ date, open, close, high, low, volume, amount
stock_hk_index_daily_em→ date, open, high, low, latest  ← 注意: 收盘列名为 latest, 须重命名为 close
Binance klines         → [openTime(ms), open, high, low, close, volume, …]  ← 数组下标取位, 非字典
70 城房价(派生)        → 见 1.4
```

### 1.3 已排除的候选源（记录理由，避免重走）

| 候选 | 排除理由 |
|---|---|
| `ak.macro_cons_gold()` / `macro_cons_silver()` | 名字像金价，实为 **SPDR / iShares ETF 持仓量**（吨/盎司），不是价格 |
| `ak.crypto_js_spot()` | 只有实时快照（10 行），且数据**停在 2023-10-02** |
| CoinGecko API | 本机代理不可达：`ProxyError` |
| OKX API | 同上，`ProxyError` |
| `ak.spot_hist_sge("Ag99.99")` 上海银 | OHLC **退化为全等于 close**（伪 OHLC），画不出真蜡烛 |
| `ak.macro_china_real_estate()` | 最新只到 2025-12，滞后近一年 |
| `ak.index_global_hist_em("道琼斯")` | 可用（9175 行）但列名为中文，同口径下新浪源更规范，选新浪 |
| `ak.stock_hk_index_daily_sina("HSI")` | 可用但起始 2013（东财 1990 起），选更长历史 |

### 1.4 房价口径推导（本设计最需要解释的一处）

**问题**：免费源里没有北京/上海的**成交均价（元/平米）**时间序列。`macro_china_new_house_price()` 提供的是 70 城价格**指数**，列为「同比 / 环比 / 定基」，其中**定基列在最新数据上为 NaN**，无法直接用。

**方案**：用**环比指数连乘**构造价格水平序列。

```
水平[0] = 100
水平[t] = 水平[t-1] × 环比[t] / 100
```

实测校验（零缺失，序列连续）：

| 城市 | 期数 | 区间 | 环比缺失 | 构造结果 |
|---|---|---|---|---|
| 北京 | 188 | 2011-01 → 2026-08 | **0** | 100 → 192.73（累计 +92.7%） |
| 上海 | 188 | 2011-01 → 2026-08 | **0** | 100 → 254.28（累计 +154.3%） |

**该口径的性质与边界**（必须写进 UI，不可伪装成成交价）：

- 它是**同质可比的定基价格指数**，衡量的是**价格变动幅度**，不含绝对价位 —— 因此「北京 192.73」**不是** 19.3 万元/平米。
- 构造值依赖统计口径的样本一致性（70 城新建商品住宅），优势是**口径长期稳定、无缺失**，恰好适合本板块「比较相对走势」的用途。
- 该序列**只有月度粒度**（`base_freq = 'M'`），且**无 OHLC** → 触发 US-3 的降级展示。
- 基准月 2011-01 = 100 是**序列自身的起点**，与归一化基准（US-4 的起点 = 100）是两件事，不可混淆。

---

## 二、架构决策

### 决策 1：独立库 `data/market.db`，独立脚本 `scripts/fetch_market.py`

**不**并入 `china_economy.db`。理由：

| 维度 | 宏观库 | 行情库 |
|---|---|---|
| 抓取节奏 | 月度数据，周更足够 | 日频数据，需每日更新 |
| 失败域 | akshare 单点 | akshare + 境外 API（Binance） |
| 表结构 | `series(indicator, date, value)` 单值序列 | `kline(symbol, date, ohlcv)` 五元组 |
| 数据规模 | 36 指标 / 约 1 万行 | 11 资产 / 约 4.4 万行 |

失败隔离是首要理由：**Binance 不可达时不能连累宏观抓取**。环境变量 `MARKET_DB_PATH` 与既有 `MACRO_DB_PATH` 对称，默认 `data/market.db`。

**代价**：两个库文件、两份路径配置。可接受 —— 二者没有跨库事务需求（不存在「一笔事务同时改宏观和行情」的场景）。

### 决策 2：日频是唯一事实源，周/月/年由纯函数聚合

**不**用 Binance 原生的 `1w` / `1M` 接口，也**不**在 Python 端预聚合存 4 张表。

```
存储:  只有日频 kline 表                        ← 唯一事实源
派生:  aggregate(rows, "W"|"M"|"Y")  纯函数      ← 视图
```

理由：

1. **口径统一**：Binance 原生周线以周一为界，A 股习惯以自然周，若混用会导致「比特币与上证按不同周界聚合」，合并图上星期错位。统一由日频聚合，11 个资产共用同一套周界定义。
2. **可测试**：聚合是 `(Candle[], Period) → Candle[]` 的纯函数，落在 domain 层，符合 spec 006「契约类逻辑必须有单测」。
3. **零冗余**：预存 4 张表 = 4 倍存储 + 4 份增量更新逻辑；且改聚合规则要重抓全部数据。
4. **量级支持**：4.4 万行全量读入内存约几十毫秒，聚合开销可忽略，无需预计算优化。

**聚合规则**（K 线通用口径）：

```
open   = 区间内首个交易日的 open
high   = 区间内 max(high)
low    = 区间内 min(low)
close  = 区间内最后一个交易日的 close
volume = 区间内 sum(volume)，任一为 null 则结果 null
date   = 区间内【最后一个交易日】的日期（K 线惯用：时间为区间结束时点）
```

**周界定义**：ISO 周（周一为起点，周日为终点）。`"W"` 的分组键为 `YYYY-Www`，展示日期取区间末日。

### 决策 3：归一化 = 「基准点 = 100」的指数化，而非 min-max

两种常见做法的取舍：

| 方案 | 公式 | 语义 | 问题 |
|---|---|---|---|
| min-max | `(v-min)/(max-min)` | 0–1 相对位置 | 归一化后**丢失涨跌幅语义** —— 看不出「+92%」；且单点异常值会压缩全部曲线 |
| **基准 = 100（选）** | `v / v_base × 100` | 相对基准日的涨跌倍数 | 无。图上「130」直接读作「较基准涨 30%」 |

**用户要的是「直观看出不同资产的走势」** —— 「涨了多少」是核心信息，故必须保留涨跌幅语义。min-max 只回答「谁在区间内更靠上」，答非所问。

**基准日的作用范围**：每张曲线**各自独立**除以「该曲线在基准日的值」。因此：

- 基准日之前无数据的资产（比特币不存在于 2011 年）→ 从其**自身首个数据点**起算（US-4 AC7），起点仍为 100，**绝不用回填值伪造历史**。
- 这保证了「起点对齐」这一视觉约定永远成立：所有曲线都从 100 出发。

### 决策 4：日期对齐 = 并集 + 前向填充

11 个资产交易日不重合（A 股春节休市、美股感恩节休市、加密 7×24、房价按月）。三种策略：

| 策略 | 结果 |
|---|---|
| 取交集 | A 股与美股年均交集仅约 200 天，**丢失 20% 交易日**，且房产（月频）会把交集压到 12 天/年 |
| **并集 + 前向填充（选）** | 保留全部时间点；休市日沿用上一收盘价（现实语义 = 「当日无成交，价格不变」） |
| 按周期聚合后对齐 | 天然较整齐，但**日粒度下仍不解决**，无法只靠它 |

**前向填充语义**：非交易日「价格维持不变」是金融上合理的假设（也即 buy-and-hold 的净值曲线）。图上以脚注注明对齐策略，避免误读为「当天有交易」。

**首个数据点之前**：填 `null`（不是 0、不是首值回填），ECharts 用 `connectNulls: false` 自然断线。

### 决策 5：粒度与窗口是**两个正交维度**

用户提的是「日/周/月/年」粒度，但仅此一维不够用：上证有 35 年数据，若「年」粒度 + 全部窗口 = 35 根蜡烛尚可，而「日」粒度 + 全部 = 8700 根，图不可读。

因此拆为两个独立控件：

| 控件 | 选项 | 默认 | 作用 |
|---|---|---|---|
| 粒度 `PeriodSwitcher` | 日 / 周 / 月 / 年 | 周 | 一根蜡烛代表多长时间 |
| 窗口 `RangeSwitcher` | 近 1 年 / 3 年 / 5 年 / 全部 | 近 5 年 | 展示多长时间跨度 |

默认「周 + 近 5 年」：11 个资产中起始最晚的是比特币（2017），5 年窗口可让**全部资产都有完整曲线**，同时周粒度下约 260 根蜡烛，密度适中。

**适用性约束**：月频资产（房价）只启用「月 / 年」粒度 —— 日/周粒度下 188 个月度点无法构成蜡烛（US-3 AC1）。UI 层置灰并给出原因，而非静默展示错误图形。

### 决策 6：`has_ohlc` 降级 —— 蜡烛图 → 折线图

房价只有单值（每个月的指数值），没有开高低收。设计上有两种处理：

- ❌ 造假：`open = high = low = close = 指数值` —— 会画出「一字线」蜡烛，视觉上暗示「该月价格无波动」，**是误导**。
- ✅ **降级折线**（选）：`has_ohlc = 0` 时图表类型切换为折线，并在卡片上标注数据性质。

同理成交量：贵金属与外盘期货源的 volume 字段**实测恒为 0**（非 0 值缺失），房产无此概念。AC4 要求「不渲染副图、不留空白区块」—— 通过 `has_volume` 判定，避免一个空坐标系占位。

### 决策 7：路由组 `(market)/` 与 `(macro)/` 同构

```
src/app/
├── (macro)/                     # spec 008
│   ├── layout.tsx               Topbar「宏观经济」+ SectionTabs + FetchButton
│   ├── macro/  industry/  alerts/
└── (market)/                    # 本 spec
    ├── layout.tsx               Topbar「资产行情」+ SectionTabs + MarketFetchButton
    ├── market/page.tsx          /market      综合对比（归一化合并图）
    ├── metal/page.tsx           /metal       贵金属
    ├── crypto/page.tsx          /crypto      加密货币
    ├── equity/page.tsx          /equity      股票指数（道指/纳指/恒指/上证）
    └── realestate/page.tsx      /realestate  房产
```

**为什么股指合一页而非按用户列举的 3/4/5 拆三页**：用户的 3/4/5 是**资产列举**，不是页面划分诉求。四个指数放在一页可以做**四线归一化对比** —— 这正是「看出不同资产走势」的直接应用；拆三页则每页只有 1–2 条线，反而削弱了对比能力。此为一处**主动设计建议**，见「待决事项 A」。

**二级菜单复用**：`SectionTabs`（spec 008）当前硬编码 `SECTION_TABS` 常量。本 spec 将其签名扩展为接收 `tabs` 与 `action` 参数（默认值保持 spec 008 行为不变），供两处复用 —— 满足 US-1 AC2「同源组件」。

### 决策 8：增量更新 = 全量幂等 upsert + `last_date` 短路

用户明确问「增量怎么更新」。方案如下：

**第一层（默认，11 个资产全部适用）**：`INSERT OR REPLACE` 全量写入。

理由：4.4 万行全量重拉实测 30–60 秒；且**幂等自带自愈能力** —— 上游修正历史数据（期货换月调整、指数基日重算）时，下一次全量抓取自动纠正，无需人工干预。增量拉取则会把错误的历史值永久留在库里。

**第二层（短路优化）**：写入前比对 `asset.last_date` 与源返回的最新日期：

```
源最新日期 <= 库中 last_date  →  跳过该资产的写入（数据已最新）
源最新日期 >  库中 last_date  →  写入（有新增交易日）
```

这一层**不减少抓取耗时**（源接口本身要调用才知道最新日期），但减少写事务与 `updated_at` 的无谓抖动，让「最近抓取时间」更如实反映数据变化。

**真正的增量拉取（仅 Binance 支持）**：Binance `klines` 接受 `startTime`，可实现「只拉 `last_date` 之后的 K 线」。但本 spec **不采用**：

- 一旦采用，Binance 走增量、其余走全量，两套逻辑要各自维护与测试；
- Binance 单币全历史仅 5 页分页（约 3 秒），增量收益微乎其微；
- 增量无法自愈历史修正（同第一层理由）。

结论：**统一全量幂等，不区分源**。这是「简单优先」而非「省几秒」的取舍。若未来资产数扩到 100+，再引入增量作为独立 spec。

**触发方式**：与 spec 003 一致 —— 页面按钮手动触发，**无定时任务**（用户明确「不需要实时」）。

### 决策 9：新增涨跌色 token，遵循中国习惯（红涨绿跌）

K 线必须表达涨跌方向。globals.css 现有 token 无涨跌色，需新增：

```css
--color-up:   #c0392b;   /* 涨 — 红 */
--color-down: #0f7b4f;   /* 跌 — 绿 */
--color-up-soft:   rgba(192, 57, 43, 0.10);   /* 面积图/高亮底 */
--color-down-soft: rgba(15, 123, 79, 0.10);
```

**方向不可颠倒**：中国（含 A 股、港股）与欧美习惯相反。本应用面向中文用户，统一**红涨绿跌**，且该规则同时作用于：K 线实体、涨跌幅文字、归一化折线（单曲线上涨时）、资产卡箭头。

> 注：归一化合并图是**多曲线**，颜色用于**区分资产**（分类色板），不用于表达涨跌 —— 涨跌由 Y 轴位置表达。两套配色语义不可混用，详见决策 10。

### 决策 10：两套配色语义分离（分类色 vs 涨跌色）

| 场景 | 配色语义 | 色板 |
|---|---|---|
| 单资产 K 线 | 涨跌 | `--color-up` / `--color-down`（红/绿两支） |
| 归一化合并图（多线） | 资产身份 | 8–10 色分类板（蓝/橙/紫/青/粉…），与涨跌无关 |
| 资产卡的「当日涨跌」文字 | 涨跌 | 红/绿 |

若合并图复用红绿色板，会出现「红色曲线到底是代表下跌还是代表某个资产」的歧义。故明确分离。分类色板需与 `--color-accent`（#185FA5）在浅色底上对比度均可辨。

### 决策 11：精度按资产配置（`asset.precision`）

11 个资产的量级与小数需求差异极大：狗狗币 0.0991 需要 4 位小数才有信息量，比特币 85331 展示 4 位小数则是噪声。故精度**存在 `asset` 表**，由数据管道声明，UI 层统一读 `precision` 格式化 —— 而非在组件里 `if (symbol === 'doge')` 硬编码。

| 资产 | precision | 示例 |
|---|---|---|
| `doge` | 4 | 0.0991 |
| `eth` `gold` `silver` | 2 | 2727.42 / 4356.60 |
| `btc` | 0 | 85331 |
| 指数类（dji/ixic/hsi/sse） | 2 | 52048.83 |
| 房产（指数，非价格） | 1 | 192.7 |

---

## 三、数据模型

```sql
-- 资产元信息（由管道写入，随抓取刷新）
CREATE TABLE IF NOT EXISTS asset (
  symbol      TEXT PRIMARY KEY,   -- 'gold' | 'btc' | 'bj_house' ...
  name        TEXT NOT NULL,      -- '黄金' | '比特币' | '北京房价'
  category    TEXT NOT NULL,      -- 'metal' | 'crypto' | 'us' | 'hk' | 'cn' | 'realestate'
  unit        TEXT NOT NULL,      -- '美元/盎司' | 'USDT' | '点' | '价格指数(2011-01=100)'
  source      TEXT NOT NULL,      -- 'comex' | 'binance' | 'sina_us' | 'em_hk' | 'em_cn' | 'nbs70'
  base_freq   TEXT NOT NULL,      -- 'D' 日频 | 'M' 月频   → 决定可用粒度
  precision   INTEGER NOT NULL,   -- 展示小数位
  has_ohlc    INTEGER NOT NULL,   -- 1 蜡烛图 | 0 折线降级
  has_volume  INTEGER NOT NULL,   -- 1 渲染量副图 | 0 不渲染
  note        TEXT,               -- 口径说明 (房价的指数口径写在这里)
  first_date  TEXT,               -- 源返回的最早日期
  last_date   TEXT,               -- 源返回的最新日期 (增量短路依据)
  updated_at  TEXT NOT NULL       -- 本次抓取时间 ISO8601
);

-- 行情 K 线（日频为唯一事实源；月频资产按自身粒度存）
CREATE TABLE IF NOT EXISTS kline (
  symbol  TEXT NOT NULL,
  date    TEXT NOT NULL,          -- 'YYYY-MM-DD' (月频资产取该月首日，与源口径一致)
  open    REAL,                   -- has_ohlc=0 时为 NULL
  high    REAL,
  low     REAL,
  close   REAL NOT NULL,          -- 唯一必填价
  volume  REAL,                   -- has_volume=0 时为 NULL
  PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_kline_symbol_date ON kline(symbol, date);
```

**设计要点**

- `PRIMARY KEY (symbol, date)` 使 `INSERT OR REPLACE` 天然幂等（US-5 AC4）。
- `close NOT NULL`，其余价格列可空 —— 直接支持决策 6 的降级（房价 `open/high/low = NULL`）。
- **不复用** 宏观库的 `series` 表：其 `value` 单列模型无法表达 OHLC，硬塞会导致语义混乱（`indicator` 里混入 `gold_open` 这类伪指标）。
- `note` 字段承载口径说明（如房价的「70 城新建商品住宅价格指数，非成交均价」），由管道写入、UI 直读，避免文案散落在组件里。

---

## 四、数据管道

`scripts/fetch_market.py`（结构沿用 `fetch_data.py`，进度协议完全一致）

```
main()
 ├─ ensure_schema()           建表 (IF NOT EXISTS), 允许空库首次运行
 ├─ for i, spec in enumerate(ASSETS):                # 11 项
 │     rows = spec.extract()                          # 单资产抓取 + 归一为 Candle
 │     if rows: upsert(spec, rows)
 │     print("@@PROGRESS {...}")                      # 逐资产进度
 └─ print("@@DONE {ok, empty, fail, failures}")
```

**单资产失败隔离**：`extract()` 包 try/except，失败记录进 `failures` 并继续下一个 —— 满足 US-5 AC5。这是必需的，因为 Binance 与 akshare 分属两个失败域。

**变量过滤**：`@EXCLUDE_CATEGORIES` 环境变量可传 `crypto` 以跳过境外源（网络受限时的降级手段），便于排障。

**进度协议**（与 spec 003 逐字一致，前端可复用同一解析逻辑）：

```json
@@PROGRESS {"done": 3, "total": 11, "key": "btc", "name": "比特币", "status": "ok"}
@@DONE     {"ok": 10, "empty": 0, "fail": 1, "failures": ["silver: HTTPError 502"]}
```

**Excel/numpy 类型转换**：akshare 返回 `numpy.float64`，`sqlite3` 不接受该类型，须统一 `float()` 转换（`fetch_data.py` 已有 `clean()` 可复用，抽出为共用工具）。

---

## 五、派生计算（domain 纯函数契约）

全部无 IO、无框架依赖，落在 `src/domain/market.ts`，单测覆盖（US 的 AC-A）。

```ts
export type Period = "D" | "W" | "M" | "Y";

export type Candle = {
  date: string;                  // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

/** 日频 → 周/月/年聚合。D 直接返回入参快照。rows 须按 date 升序。 */
export function aggregate(rows: Candle[], period: Period): Candle[];

/** 归一化到基准点 = 100。baseDate 缺省取该序列首个点；早于 base 的点不参与。 */
export function normalize(
  rows: Candle[],
  baseDate?: string,
): Array<{ date: string; value: number }>;

/** 日期轴取并集(升序) + 各序列前向填充；首点之前为 null。 */
export function alignSeries(
  series: Record<string, Array<{ date: string; value: number }>>,
): { dates: string[]; aligned: Record<string, Array<number | null>> };

/** 按窗口裁剪：'1Y' | '3Y' | '5Y' | 'ALL'，以最后一条数据的日期为锚点向前推。 */
export function sliceRange(rows: Candle[], range: Range): Candle[];
```

**`aggregate` 的周界实现要点**：ISO 周分组键须由日期计算，不可用简单 `Math.floor(dayOfYear/7)`（跨年周会错位）。建议键 = 该日期所在周的**周一日期**，天然可比较、可排序。

**`normalize` 的边界**：`baseDate` 落在序列首个点之前时，取首个点作为基准（不得抛错、不得返回空）；基准值 `close = 0` 时返回全 `null` 而非 `Infinity`（防御脏数据）。

---

## 六、接口契约

| 方法 | 路径 | 查询参数 | 返回 |
|---|---|---|---|
| GET | `/api/market/assets` | — | `{ updatedAt, assets: AssetStat[] }` |
| GET | `/api/market/kline` | `symbol`, `period`, `range` | `{ symbol, period, candles: Candle[] }` |
| GET | `/api/market/compare` | `symbols`(逗号分隔), `period`, `range`, `base?` | `{ dates, series: {symbol: (number\|null)[]}, bases: {symbol: date} }` |
| POST | `/api/market/fetch` | — | `202 {jobId}` / `409 {error}` |
| GET | `/api/market/fetch/status` | — | `FetchJobState`（结构同 spec 003） |

```ts
type AssetStat = {
  symbol: string; name: string; category: string; unit: string;
  precision: number; hasOhlc: boolean; hasVolume: boolean;
  baseFreq: string; note: string | null;
  lastDate: string; stale: boolean; lagDays: number | null;
  latest: { date: string; close: number } | null;
  changePct: number | null;        // 最新一日涨跌
  rangeChangePct: number | null;   // 所选窗口内涨跌
};
```

`compare` 的 `bases` 回传每个资产**实际采用的基准日** —— 因不同资产起始日期不同（US-4 AC7），前端需据此在图例标注，不能假设基准日统一。

---

## 七、信息架构与组件

```
侧边栏（一级）
├── 工作台        /
├── 宏观经济      /macro     ← spec 008
├── 资产行情      /market    ← 本 spec（一级入口 = 综合对比）
│     └─ 顶部二级菜单
│          ├── 综合对比   /market      归一化合并图 + 11 张资产卡
│          ├── 贵金属     /metal       黄金、白银
│          ├── 加密货币   /crypto      比特币、以太坊、狗狗币
│          ├── 股票指数   /equity      道琼斯、纳斯达克、恒生、上证
│          └── 房产       /realestate  北京、上海
└── 设置          /settings
```

**组件清单**

| 组件 | 类型 | 职责 | 关键约束 |
|---|---|---|---|
| `(market)/layout.tsx` | Server | Topbar + SectionTabs + MarketFetchButton + 滚动容器 | 与 `(macro)/layout.tsx` 同构 |
| `market/period-switcher.tsx` | Client | 日/周/月/年 + 窗口选择 | 接收 `disabledPeriods`，月频资产禁用日/周 |
| `market/kline-chart.tsx` | Client | 蜡烛图（含折线降级）+ 量副图 + dataZoom | 接收纯 `Candle[]`，内部不做数据加工（conventions 规则 4） |
| `market/normalized-chart.tsx` | Client | 归一化多曲线合并图 | 分类色板；`connectNulls: false`；图例可切换 |
| `market/asset-card.tsx` | Client | 资产卡（最新价/涨跌/逾期/迷你图） | 读 `precision` 格式化；涨跌红绿 |
| `market/asset-picker.tsx` | Client | 合并图的资产勾选器（1–11 个约束） | 默认勾选 5 个代表资产 |

**ECharts 实现备忘**（踩坑预防）

- `candlestick` 的数据项顺序是 **`[open, close, low, high]`**（不是 OHLC 直觉顺序）。写反会导致图形畸变且不报错。
- `series.data` 中 `null` 会被识别为缺失；配合 `connectNulls: false` 断线。
- 成交量副图用第二个 `grid` + `xAxis`（`axisPointer.link` 联动），非同一坐标系叠加。
- **Turbopack 兼容**：沿用 spec 001 的结论 —— 用完整包 `import * as echarts from "echarts"`，不用 `echarts/core` 按需导入（按需导入在 Turbopack 下报 `Renderer 'undefined'`）。
- 大数据量下 `dataZoom` + `large: true`；日粒度 5 年约 1200 点，无需 `sampling`。

**交互一致性**：粒度/窗口切换是**纯客户端状态**，数据一次性取回后在浏览器内聚合（约 4 万行，毫秒级）—— 满足 US-2 AC2「不重新请求数据库」。但注意：**聚合在 domain 层实现，客户端组件引入的是纯函数**，不违反 conventions 规则 3（该规则禁止的是服务端仓储/用例进入客户端）。

---

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| **Binance API 不可达** | 3 个加密资产无数据 | 实测本机可达（走系统代理）；提供 `@EXCLUDE_CATEGORIES` 降级；失败隔离保证其余 8 个资产正常 |
| 东财/新浪接口字段变更 | 单个资产抓取失败 | 显式列映射 + 失败隔离；管道输出 `failures` 明细可见 |
| akshare 版本升级破坏接口 | 同上 | `akshare` 版本写入 `requirements` 记录；接口调用集中在 `ASSETS` 常量表，便于批量修 |
| 归一化被误读为「绝对价格」 | 用户误判资产规模 | Y 轴标注「指数化（基准 = 100）」；房产额外标注指数口径（决策 6） |
| 前向填充被误读为「当日有交易」 | 对交易日数量的误判 | 图上脚注注明对齐策略（决策 4） |
| 全量抓取耗时增长 | 体验下降 | 当前 30–60s；资产数 > 30 时再引入真增量（独立 spec） |

---

## 九、测试策略

| 层 | 覆盖 | 位置 |
|---|---|---|
| domain（单测，spec 006） | `aggregate` 四档粒度的 OHLC 取法；周界跨年正确性；`normalize` 起点恒 100 / 基准日早于首点 / 基准为 0；`alignSeries` 并集与前向填充边界；`sliceRange` 窗口锚点 | `src/domain/market.test.ts` |
| application（集成，spec 007） | 真实 SQLite fixture 打通 repository → service：资产统计（涨跌幅、滞后判定、精度透传）、K 线读取与聚合、compare 的 bases 回传、空库/缺表降级 | `src/application/market-service.test.ts` |
| presentation | 不覆盖（沿用 spec 006/007 约定） | — |

**fixture 设计**：沿用 spec 007 的做法 —— 日期相对当前日生成（防断言腐化），临时库写 `os.tmpdir()`，通过 `MARKET_DB_PATH` 注入，绝不触碰 `data/market.db`。

**必测的契约边界**（固化进断言，防回归）：

1. 周聚合跨年：2025-12-29（周一）~ 2026-01-04 应归入**同一周**，不得被年份切断。
2. 归一化：三条起始日期不同的序列，各自起点均为 100，且 `bases` 记录各自首个日期。
3. 前向填充：A 序列缺 3 个交易日，对齐后这 3 天沿用前值（非 `null`）；序列起点之前为 `null`。
4. 聚合的量：任一子项 `volume = null` 时结果 `null`（不把 null 当 0 求和）。
5. 月频资产的 `aggregate(rows, "D")` 应原样返回（不报错、不伪造日频）。

---

## 十、已确认决策（2026-09-22）

| 议题 | 决定 | 对本文档的影响 |
|---|---|---|
| 二级菜单划分 | **5 项**：综合对比 / 贵金属 / 加密货币 / **股票指数** / 房产 | 决策 7 成立 —— 四个指数合为一页做四线归一化对比，不按市场拆三页 |
| 金银价格口径 | **COMEX 期货，美元/盎司** | 1.1 选型成立；上海金交所（人民币/克）作为备选记录在 1.3，本期不实现 |
| 存储位置 | **独立库 `data/market.db`** | 决策 1 成立 —— 与宏观库失败隔离、抓取节奏独立 |

三项均取推荐方案，无设计变更。

## 变更记录

- 2026-09-22: 验收目检发现 ECharts 图表初始化 bug（首帧空数据走早退分支致初始化 effect 空跑），`KLineChart` / `NormalizedChart` 改为惰性初始化；坑沉淀至 conventions「行情数据口径」。
- 2026-09-22: **数据源加固**。验收当日下午东财 push2 端点（`push2his` / `15.push2`）间歇性完全不可达（代理与直连均 000，新浪正常），导致 hsi/sse 抓取失败。两项加固：(1) 提取器加重试（3 次退避，只读请求无副作用）；(2) hsi/sse 增配**新浪备用源**（`stock_hk_index_daily_sina("HSI")` 2013-08 起 / `stock_zh_index_daily("sh000001")` 同结构），主源异常自动降级。降级实测：东财不可达时 11/11 全 SKIP、0 失败。备用源历史起点晚于主源（恒生 2013 vs 1990），但库内已有全历史 + 增量 upsert，仅在冷启动遇上源故障时才有影响，可接受。
