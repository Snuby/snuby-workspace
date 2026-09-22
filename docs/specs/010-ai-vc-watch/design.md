# 010 — 设计

> 本文档所有数据源结论均为 **2026-09-22 在本机实测**（macOS，默认网络环境），非文档推断。接口行为会随上游变化，实现阶段须以实测为准。

---

## 一、数据源（实测）

### 1.1 选型结果

| 源 | 形态 | 鉴权 | 实测结果 | 用途 |
|---|---|---|---|---|
| **TechCrunch Venture RSS** | RSS 2.0（WordPress） | 无 | ✅ `https://techcrunch.com/category/venture/feed/` 返回完整 XML，`sy:updatePeriod=hourly`，条目含 title/link/description/pubDate/guid | **英文主源**：融资新闻第一手，标题常含金额与轮次 |
| **Hacker News Algolia API** | JSON API | 无 | ✅ `https://hn.algolia.com/api/v1/search_by_date` 返回结构化 JSON；支持 `tags` / `numericFilters` / `restrictSearchableAttributes=title` | **英文补充**：可回填历史（按日期范围），社区发现的早期项目 |
| datapile | Next.js SPA | 无 | ⚠️ `/api/investors/featured` 可返回 JSON（投资人数据）；`/api/deals*` 返回 HTML 壳，**deal 数据端点未确认** | 备选（实现阶段再探），本期不依赖 |
| IT桔子 | 网页 | 无 | ❌ **瑞数动态防护**（HTTP 412 + `$_ts` 混淆脚本，企业级反爬，脚本无法绕过，须真实浏览器执行 JS） | 不可程序化抓取 → 人工录入通道 |
| 烯牛数据 | SPA | 登录/token | ❌ 首页为 JS 壳（数据异步加载），业务数据需注册获取 API key | 未来如用户注册可接 MCP/API，本期预留适配器接口 |
| Dealroom | SSR 营销页 | — | ❌ 公开页 78 个 `"company"` 均为**生态图谱节点**（`{n,c,x,y}`），**无融资交易数据**；真实 deal flow 在需登录的 `app.dealroom.co` | 不可程序化抓取 |
| 36氪快讯 | gateway API | 签名 | ❌ `gateway.36kr.com` 返回空响应，请求需内部签名参数 | 排除（记录理由，避免重走） |
| MapCo AI Deals | 网页 | 无 | ❌ 本机 HTTP 403 | 排除 |

**结论**：英文源（TechCrunch RSS + HN Algolia）可**无鉴权程序化抓取**，作为管道主源；中文源（IT桔子 / 烯牛 / Dealroom）均有企业级防护或需登录，**不硬啃** —— 中文事件走**人工录入**（用户浏览 IT桔子 / 烯牛 / 公众号 / 晚点时顺手录入），这与用户「数据慢慢积累」的诉求一致。

### 1.2 字段来源说明

- **TechCrunch RSS**：条目 `title`（如 `Morphotonics raises €40M to expand nano-imprint...`）、`link`、`description`（摘要）、`pubDate`、`guid`。金额/轮次/赛道均需从 title+description **解析**（见第五节纯函数），解析失败标「未披露 / 未分类」，不伪造。
- **HN Algolia**：查询策略 `tags=story&restrictSearchableAttributes=title`，关键词集 `["raises", "funding", "series", "raised"]` 组合 `numericFilters=created_at_i>...` 回填历史。条目含 `objectID`（去重键）、`title`、`url`、`created_at`、`story_text`。

---

## 二、架构决策

### 决策 1：独立库 `data/vc.db`，独立脚本 `scripts/fetch_vc.py`

**不**并入 `market.db` 或 `china_economy.db`。理由（沿用 009 决策 1 的失败隔离原则）：

| 维度 | 行情库 | 创投库 |
|---|---|---|
| 抓取节奏 | 日频，需每日更新 | 融资事件稀疏，周更或按需即可 |
| 失败域 | akshare + 境外 API | RSS + HN API（与行情源不重叠） |
| 表结构 | `kline` 五元组 | `deal_event` 事件行 |
| 数据来源 | 全自动 | 自动 + 人工混合 |

环境变量 `VC_DB_PATH` 与 `MACRO_DB_PATH` / `MARKET_DB_PATH` 对称，默认 `data/vc.db`。

### 决策 2：多源适配器 + 统一事件模型

所有来源（techcrunch / hn / manual / 未来烯牛）解析后归入**同一张 `deal_event` 表**，`source` 列标注来源。理由：

- 可视化分析（赛道分布 / 月度趋势）需要对**全库事件**统一聚合，分表会拆散分析面。
- 各源字段差异（RSS 有 guid、Algolia 有 objectID、人工无）统一收敛为 `source_id` 一列。

### 决策 3：去重键 = `(source, source_id)`，幂等 upsert

- 主键 `id = source + ":" + source_id`（如 `techcrunch:https://techcrunch.com/...`、`hn:41234567`、`manual:<uuid4>`）。
- `INSERT OR REPLACE` 天然幂等（US-3 AC4）。上游修正条目时重跑自愈。
- 人工录入的同 URL 重复：`url` 上建**非唯一索引**（不强制唯一，允许同链接多轮次），提交时查询提示 409，由用户决定（US-4 AC3）。

### 决策 4：金额解析 = 纯函数，解析失败标 NULL（未披露）

`parseAmount(text)` 从标题+摘要提取金额：

- 支持 `$10M` / `$100m` / `€40M` / `£1.2B` / `¥500M` 及中文「10 亿元」「5000 万美元」。
- 输出 `{ amount: number, currency: 'USD'|'EUR'|'GBP'|'CNY'|... }`；解析不到返回 `null`。
- **不换算、不猜测**：原币种存 `amount` + `currency`；`amount_usd` 由管道按**近似汇率常量表**换算（`EUR≈1.08`、`GBP≈1.27`、`CNY≈0.14`，标注「近似，仅用于聚合比较」），未披露两列均为 NULL。
- 可视化金额聚合**只计入 `amount_usd` 非空**的事件（US-5 AC4）。

### 决策 5：赛道分类 = 关键词规则（domain 纯函数）

`classifySector(title + description)` 按关键词命中打分取最高分赛道，未命中标 `unclassified`：

| 赛道 | 关键词（命中即 +1，多词叠加取最高） |
|---|---|
| `ai-infra`（基础设施） | compute / gpu / chip / datacenter / infra / inference / training / cluster |
| `foundation-models`（大模型） | llm / foundation model / gpt / frontier / language model / multimodal |
| `agents`（智能体） | agent / autonomous / copilot |
| `robotics`（具身智能） | robot / humanoid / embodied / drone |
| `ai-app`（AI 应用） | app / consumer / saas / enterprise / vertical |
| `devtools`（开发者工具） | devtools / developer / open source / sdk / api |
| `health`（医疗） | health / bio / drug / clinical / pharma |
| `fintech`（金融） | fintech / finance / payment / bank |
| `data`（数据） | dataset / data / synthetic |
| `security`（安全） | security / safety / alignment / red team |

赛道常量表维护在 `src/domain/vc.ts`（`SECTOR_TAGS`），与 009 的 `INDICATOR_DESCRIPTIONS` 同模式 —— 文案/规则进 domain，不散落在组件或管道。

### 决策 6：中文数据走「人工录入」，预留适配器接口

实测结论（1.1）：IT桔子（瑞数反爬）、烯牛（登录）、Dealroom（app 内）均不可无鉴权抓取。**本期不绕过反爬**（违背轻量管道原则且违反站点意图）。

- 提供人工录入表单（US-4），用户浏览中文渠道时录入。
- 管道侧预留适配器注册表（`SOURCES` 常量），未来烯牛 MCP / IT桔子开放接口可插拔接入，**不改表结构**（`source` 是开放枚举）。

### 决策 7：路由组 `(vc)/`，两个子页

```
src/app/(vc)/
├── layout.tsx            Topbar「AI 创投观察」+ SectionTabs + VcFetchButton
├── page.tsx              /ai-vc              融资事件流
└── analytics/page.tsx    /ai-vc/analytics    赛道分布 + 月度趋势
```

与 `(macro)/` `(market)/` 同构；`SectionTabs` 已支持参数化（009 决策 7 扩展），直接复用。

### 决策 8：增量更新 = 幂等 upsert + 增量拉取

与 009 决策 8 的取舍不同（RSS 无分页历史），此处**两源各自按能力取增量**：

- **TechCrunch RSS**：RSS 只返回最近约 20–50 条 → 全量取回 + 幂等 upsert（重复自动覆盖），`latest_date` 短路（源最新 pubDate ≤ 库内最新时跳过写事务）。
- **HN Algolia**：支持 `numericFilters=created_at_i>{last_ts}` **真增量** —— 首次运行回填近 90 天（存量），之后只拉上次之后的新条目。不牺牲自愈：HN 条目不可变（objectID 幂等），自愈由 TechCrunch 全量覆盖承担。
- **人工录入**：实时写库，不经管道。

**触发方式**：页面按钮手动触发（沿用 spec 003），**无定时任务**。用户「数据慢慢积累」由「每次手动更新拉增量 + 随时人工录入」共同实现。

### 决策 9：金额展示精度与格式

- `amount_usd` 展示统一用紧凑格式：`$10.0M` / `$1.2B`（`formatUsd` 纯函数），未披露显示「未披露」。
- 中文金额（`CNY`）在事件行内以「原币种金额」展示（如 `¥7000万`），`amount_usd` 仅用于聚合比较，不覆盖原币展示 —— 保持「数据真实」优先。

---

## 三、数据模型

```sql
-- AI 融资事件（多源统一模型，spec 010）
CREATE TABLE IF NOT EXISTS deal_event (
  id            TEXT PRIMARY KEY,      -- '{source}:{source_id}'，幂等 upsert 去重键
  company       TEXT NOT NULL,         -- 公司名（人工录入时必填）
  round         TEXT,                  -- 轮次归一化: 'Seed'|'A'|'B'|...|'Pre-seed'|NULL=未披露
  amount        REAL,                  -- 原币种金额（NULL = 未披露）
  currency      TEXT,                  -- 原币种 'USD'|'EUR'|'GBP'|'CNY'|...
  amount_usd    REAL,                  -- 近似汇率换算（仅聚合比较用，口径见决策 4）
  announced_at  TEXT NOT NULL,         -- 公告日期 'YYYY-MM-DD'（索引列）
  sector        TEXT NOT NULL DEFAULT 'unclassified',  -- 赛道（SECTOR_TAGS）
  source        TEXT NOT NULL,         -- 'techcrunch'|'hn'|'manual'|...
  source_id     TEXT NOT NULL,         -- 源内唯一 id（guid / objectID / uuid4）
  title         TEXT,                  -- 原始标题
  url           TEXT,                  -- 原文链接（非唯一索引，允许同链接多轮次）
  notes         TEXT,                  -- 备注（人工录入的口径/核实说明）
  created_at    TEXT NOT NULL,         -- 入库时间
  updated_at    TEXT NOT NULL          -- 最近更新
);

CREATE INDEX IF NOT EXISTS idx_deal_announced ON deal_event(announced_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_sector    ON deal_event(sector);
CREATE INDEX IF NOT EXISTS idx_deal_source    ON deal_event(source);
CREATE INDEX IF NOT EXISTS idx_deal_url       ON deal_event(url);
```

**设计要点**

- `PRIMARY KEY (id)` 使 `INSERT OR REPLACE` 幂等（US-3 AC4）。
- `announced_at` / `sector` / `source` 建索引：事件流倒序、赛道聚合、来源过滤都走索引。
- `url` 非唯一索引：支持「同链接多轮次」的人工录入场景（US-4 AC3）。
- 不设 `amount_usd NOT NULL`：未披露事件也必须入库（事件本身有信息量），金额缺失不影响事件流展示。
- 赛道用 `TEXT` + domain 常量表（而非 ENUM），便于未来扩展赛道不迁移表。

---

## 四、数据管道

`scripts/fetch_vc.py`（结构沿用 `fetch_market.py`：进度协议 / 失败隔离 / 幂等写入）

```
main()
 ├─ ensure_schema()           建表 (IF NOT EXISTS)
 ├─ for src in SOURCES:                           # techcrunch → hn
 │     rows = src.extract()                        # 抓取 + 解析为 DealEvent 行
 │     if rows: upsert(conn, src.name, rows)
 │     print("@@PROGRESS {...}")                   # 逐来源进度
 └─ print("@@DONE {ok, empty, fail, failures}")
```

**各来源提取器**

| 来源 | 提取逻辑 | 关键点 |
|---|---|---|
| `extract_techcrunch()` | `xml.etree` 解析 RSS → 每 item 生成事件 | title 含金额/轮次 → `parseAmount` / `normalizeRound`；`sector` = `classifySector(title+desc)`；`id = "techcrunch:" + guid` |
| `extract_hn()` | Algolia API 分页拉取，`tags=story` + 标题关键词 + `numericFilters` 增量 | `id = "hn:" + objectID`；无金额关键词的条目标 NULL；时间用 `created_at` |
| （预留）`extract_xiniu()` | 烯牛 API 适配器 | 本期不实现，注册表占位 |

**幂等与短路**：`INSERT OR REPLACE`；写入前比对 `announced_at` 最大日期（TechCrunch 用 pubDate、HN 用 created_at），源最新 ≤ 库内最新时跳过写事务（输出 `[SKIP]`）。

**失败隔离**：单来源 try/except，失败进 `failures` 不中断（US-3 AC5）；HN 不可达时 TechCrunch 正常入库，反之亦然。

**进度协议**（与 spec 003/009 逐字一致，前端复用同一解析逻辑）：

```json
@@PROGRESS {"done": 1, "total": 2, "key": "techcrunch", "status": "ok"}
@@DONE     {"ok": 1, "empty": 0, "fail": 1, "failures": ["hn: HTTPError 502"]}
```

**存量回填（US-3 AC6）**：首次运行时 `hn` 源以 `numericFilters=created_at_i>{now-90d}` 回填近 90 天；TechCrunch RSS 受限于协议只有最近条目 —— 如实呈现在「数据新鲜度」说明中，**不伪装全历史**。

---

## 五、派生计算（domain 纯函数契约）

全部无 IO、无框架依赖，落在 `src/domain/vc.ts`，单测覆盖（US 的 AC-A）。

```ts
export type Sector =
  | "ai-infra" | "foundation-models" | "agents" | "robotics"
  | "ai-app" | "devtools" | "health" | "fintech" | "data" | "security"
  | "unclassified";

export type DealEvent = {
  id: string;                // "{source}:{source_id}"
  company: string;
  round: string | null;      // 归一化轮次
  amount: number | null;     // 原币金额
  currency: string | null;
  amountUsd: number | null;  // 近似换算
  announcedAt: string;       // YYYY-MM-DD
  sector: Sector;
  source: string;
  sourceId: string;
  title: string | null;
  url: string | null;
  notes: string | null;
};

/** 金额解析: 支持 $10M / €40M / £1.2B / ¥500M / 中文"10亿元"；解析失败返回 null */
export function parseAmount(text: string): { amount: number; currency: string } | null;

/** 轮次归一化: "Series A"/"series-a"/"A 轮" → "A"；"seed"/"天使轮" → "Seed"；未知 → null */
export function normalizeRound(text: string): string | null;

/** 赛道分类: 关键词命中取最高分；未命中 → "unclassified" */
export function classifySector(text: string): Sector;

/** 去重键: "{source}:{sourceId}" */
export function dealKey(source: string, sourceId: string): string;

/** 月度分组键: "2026-09" */
export function monthKey(date: string): string;

/** 金额紧凑格式: 10_000_000 → "$10.0M"；1_200_000_000 → "$1.2B"；null → "未披露" */
export function formatUsd(amountUsd: number | null): string;

/** 近似汇率换算（决策 4 常量表） */
export function toUsd(amount: number, currency: string): number | null;
```

**边界要求**（写入单测断言）

1. `parseAmount("raises $10M")` → `{10_000_000, USD}`；`parseAmount("€40M")` → EUR；`parseAmount("无金额")` → `null`；`parseAmount("10亿元")` → CNY；多金额时取**首个**命中（标题优先于摘要）。
2. `normalizeRound("Series A")` / `"A轮"` → `"A"`；`"Pre-seed"` → `"Pre-seed"`；未知 → `null`。
3. `classifySector("raises for GPU cloud")` → `ai-infra`；无关文本 → `unclassified`。
4. `toUsd`：USD → 原值；EUR → ×1.08；未支持币种 → `null`（不猜）。
5. `formatUsd(null)` → `"未披露"`；`formatUsd(50_000_000)` → `"$50.0M"`；`formatUsd(2_500_000_000)` → `"$2.5B"`。

---

## 六、接口契约

| 方法 | 路径 | 参数 | 返回 |
|---|---|---|---|
| GET | `/api/vc/deals` | `sector?` `source?` `minUsd?` `limit?(≤200, 默认50)` `offset?` | `{ updatedAt, total, latestDate, deals: DealEventView[] }` |
| GET | `/api/vc/stats` | `by=sector\|month` `source?` `sector?` | `{ by, items: {key, count, amountUsd}[] , period }` |
| POST | `/api/vc/deals` | body（人工录入字段） | `201 {deal}` / `400 {errors}` / `409 {duplicateUrl}` |
| POST | `/api/vc/fetch` | — | `202 {jobId}` / `409 {error}` |
| GET | `/api/vc/fetch/status` | — | `FetchJobState`（结构同 spec 003） |

```ts
type DealEventView = {
  id: string; company: string; round: string | null;
  amountUsd: number | null; amount: number | null; currency: string | null;
  announcedAt: string; sector: Sector; source: string;
  title: string | null; url: string | null; notes: string | null;
};
```

人工录入 body 校验规则（US-4 AC2）：

```ts
{
  company: string;          // 必填，trim 后非空
  announcedAt: string;      // 必填，YYYY-MM-DD 且非未来日期
  round?: string;           // 可选，经 normalizeRound 归一化，非法值存原文
  amount?: number; currency?: string;  // 可选；currency ∈ 预置枚举
  sector?: Sector;          // 可选；缺省 classifySector(company + notes)
  url?: string; notes?: string;
}
```

---

## 七、信息架构与组件

```
侧边栏（一级）
├── 工作台        /
├── 宏观经济      /macro
├── 资产行情      /market
├── AI 创投观察   /ai-vc      ← 本 spec（一级入口 = 事件流）
│     └─ 顶部二级菜单
│          ├── 事件流   /ai-vc           融资事件列表 + 统计摘要 + 新增按钮
│          └── 分析     /ai-vc/analytics 赛道分布 + 月度趋势
└── 设置          /settings
```

**组件清单**

| 组件 | 类型 | 职责 |
|---|---|---|
| `(vc)/layout.tsx` | Server | Topbar + SectionTabs + VcFetchButton + 滚动容器 |
| `vc/deal-table.tsx` | Server | 事件列表（分页 / 过滤 / 来源徽标 / 链接），直读用例视图模型 |
| `vc/deal-form.tsx` | Client | 人工录入表单（字段校验 + 409 重复提示） |
| `vc/vc-fetch-button.tsx` | Client | 抓取按钮 + 进度条 + 防重复（复用 spec 003 交互模式） |
| `vc/sector-chart.tsx` | Client | 赛道分布图（计数/金额口径切换） |
| `vc/monthly-trend.tsx` | Client | 月度融资趋势（柱=事件数，线=金额，双轴） |
| `vc/freshness-hint.tsx` | Server | 数据新鲜度提示（最新事件日期 / 抓取时间 / 滞后警示） |

**ECharts 实现备忘**（沿用 009 踩坑沉淀）

- 图表组件**惰性初始化**：首帧可能无数据（空库），初始化与 `setOption` 合并进同一 effect，否则图表永久空白（009 tasks I4 教训）。
- 双轴图（柱+线）**每个 series 显式绑定 `yAxisIndex`**，口径不同必须双轴。
- 完整包导入 `import * as echarts from "echarts"`（Turbopack 下按需导入报 `Renderer 'undefined'`）。

---

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| TechCrunch RSS 结构变更 | 英文源中断 | 提取器集中在 `SOURCES` 注册表 + 失败隔离；RSS 是 WordPress 标准结构，变更概率低 |
| HN Algolia 限流/变更 | 补充源中断 | 单源失败隔离；TechCrunch 独立可用；请求带 3 次退避重试 |
| 金额/赛道解析不准 | 聚合口径偏差 | 解析为纯函数 + 单测锁边界；解析失败标 NULL/`unclassified` 而非猜测；未披露不计入金额聚合 |
| 中文事件覆盖不足 | 分析面偏英文 | 人工录入通道 + 未来烯牛 MCP 适配器；板块如实展示「数据覆盖说明」 |
| 人工录入重复 | 数据噪声 | 同 URL 提示 409；`(source, source_id)` 幂等；列表展示可见可溯 |
| 汇率近似换算被误读为精确 | 金额比较失真 | `amount_usd` 口径在 tooltip/图表注脚标注「近似换算」；原币金额始终展示 |
| 库越来越大（事件持续积累） | 查询变慢 | `announced_at`/`sector`/`source` 索引；分页 ≤200；量级（年数千条）远未到瓶颈 |

---

## 九、测试策略

| 层 | 覆盖 | 位置 |
|---|---|---|
| domain（单测，spec 006） | `parseAmount` 多币种/中文/未披露/多金额取首；`normalizeRound` 中英文轮次；`classifySector` 全赛道关键词 + 未命中；`toUsd` 支持/不支持币种；`formatUsd` 边界（null/M/B）；`dealKey`/`monthKey` | `src/domain/vc.test.ts` |
| application（集成，spec 007） | 真实 SQLite fixture（`VC_DB_PATH` → `os.tmpdir()`）：事件流倒序/过滤/分页；stats 按赛道/月份聚合（未披露不计金额）；人工录入校验（合法/非法日期/空公司/重复 URL 409）；空库降级 | `src/application/vc-service.test.ts` |
| presentation | 不覆盖（沿用 spec 006/007 约定） | — |

**fixture 设计**：沿用 spec 007 —— 日期相对当前日生成（防断言腐化），临时库写 `os.tmpdir()`，绝不触碰 `data/vc.db`。

**必测的契约边界**

1. `parseAmount("$10M and €40M")` 取首个 → USD。
2. `classifySector` 对 `unclassified` 输入不抛错。
3. 聚合时 `amount_usd IS NULL` 的事件计入 count、不计入金额合计。
4. 人工录入未来日期被拒绝；`announced_at` 非法格式被拒绝。
5. 重复 URL 录入返回 409，但强制确认后仍可写入（同链接多轮次）。

---

## 十、待决事项（提交评审）

| 议题 | 候选 | 建议 |
|---|---|---|
| 板块名称与路由 | 「AI 创投观察」`/ai-vc`；或「创投观察」`/vc` | 推荐 `ai-vc`（内容锁定 AI 赛道） |
| 二级菜单划分 | 事件流 + 分析 两页；或单页 + Tab 内切换 | 推荐两页（分析页为后续扩展留空间） |
| 中文数据获取 | 本期人工录入；或用户注册烯牛 API key 后接适配器 | 推荐先人工录入跑通，烯牛后置 |
| 金额展示 | 原币 + USD 近似换算；或仅原币 | 推荐双展示（原币为主，USD 仅聚合） |

---

## 变更记录

- 2026-09-22: 初版（draft）。数据源结论基于本机实测（TechCrunch RSS / HN Algolia 可用；IT桔子瑞数反爬 412、烯牛 SPA、Dealroom 公开页无交易数据、36氪需签名、MapCo 403 均排除或降级），见 design 第一节。待用户确认第十节四项决策后转 `reviewed`。
