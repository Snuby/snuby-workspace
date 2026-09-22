# Snuby 工作台

本地 Web 工作台（Next.js）。采用 SDD（规格驱动开发）开发，规格文档见 [`docs/`](docs/README.md)。

## 快速开始

```bash
npm install          # 安装依赖
npm run fetch        # 抓取宏观数据写入 data/china_economy.db (需 python venv)
npm run fetch:market # 抓取资产行情写入 data/market.db (11 项资产, 幂等)
npm run build && npm start   # 生产模式 http://localhost:3300 (日常使用推荐)
npm test             # 测试套件 (97 例: domain 单测 + application 集成测试)
```

开发模式: `npm run dev`。注意 dev 模式每次导航需现场编译，页面响应 ~2s，属正常现象；日常使用请用生产模式（响应 ~0.2s）。改代码后需重新 `npm run build && npm start`。

> 端口约定: 默认使用 **3300**，避开本机其他工作台应用占用的 3000/3100。

## 目录结构

```
snuby-workspace/
├── docs/                  # SDD 文档 (流程/规范/规格)
│   ├── README.md          # SDD 工作流
│   ├── conventions.md     # 编码与架构规范 (含术语表、数据口径)
│   ├── specs/001-workbench-mvp/
├── scripts/
│   ├── fetch_data.py      # Python 宏观数据管道 (akshare -> SQLite)
│   └── fetch_market.py    # Python 行情数据管道 (akshare/Binance -> SQLite)
├── data/                  # SQLite 数据库 (gitignore, 可由管道重建)
└── src/
    ├── domain/            # 领域类型与规则
    ├── application/       # 用例编排
    ├── infrastructure/    # SQLite 仓储
    ├── components/        # UI 组件 (workbench / macro / market)
    └── app/               # Next.js 路由 (页面 + API)
```

## 功能模块

- **工作台首页** `/` — 模块卡片入口（含跟踪提醒摘要）
- **国家经济数据** `/macro` — 26 项中国宏观经济指标，按维度分组，近 36 期趋势图，手动更新按钮（滞后项有标注）
- **行业观察** `/industry` — 10 项行业与高频指标（用电量/货运量/客座率/物流景气/大宗商品与建材价格），日频月末采样（spec 005）
- **跟踪提醒** `/alerts` — 8 条预置规则实时评估，触发中/正常/无数据分组展示（spec 002）
- **资产行情** `/market` — 综合对比：11 项资产归一化合并图（基准点 100）+ 资产卡，日/周/月/年粒度（spec 009）
  - `/metal` 贵金属（黄金/白银 COMEX）· `/crypto` 加密货币（BTC/ETH/DOGE）· `/equity` 股票指数（道指/纳指/恒生/上证）· `/realestate` 房产（京沪房价，月频）
- **API** `GET /api/macro/indicators` — 指标数据 JSON（契约见 spec 001 design.md）
- **API** `GET /api/macro/alerts` — 告警评估结果 JSON（契约见 spec 002 design.md）
- **API** `GET /api/market/assets` / `kline` / `compare` — 行情数据 JSON（契约见 spec 009 design.md）
- **设置** `/settings` — 数据管道信息

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MACRO_DB_PATH` | `<项目根>/data/china_economy.db` | 宏观数据库路径 |
| `MARKET_DB_PATH` | `<项目根>/data/market.db` | 行情数据库路径 |
| `FETCH_PYTHON_BIN` | 本地 venv python（含 akshare） | 抓取子进程使用的 Python 解释器 |

## 数据管道

`scripts/fetch_data.py` 通过 akshare 抓取 36 项指标（26 宏观 + 10 行业）（国家统计局/央行/海关总署/东财口径），幂等写入 SQLite。单指标失败不影响其他。数据口径备忘见 `docs/conventions.md`。

数据源优先使用国家统计局官方接口；确认无免费替代源的指标（社融增量/企业景气/国房景气）在界面标注滞后月数（spec 004）。

数据更新为**手动触发**: `/macro` 页「更新数据」按钮 → `POST /api/macro/fetch`（运行中重复请求返回 409）→ 轮询 `GET /api/macro/fetch/status` 显示逐指标进度（spec 003）。定时任务已于 spec 003 取消。

行情管道 `scripts/fetch_market.py` 抓取 11 项资产日线（43,000+ 行），幂等 upsert + `last_date` 短路；`/market` 页「更新行情」按钮触发 `POST /api/market/fetch`，亦可 `npm run fetch:market` 独立执行。数据源与口径详见 `docs/conventions.md`「行情数据口径」。

Python 环境: `/Users/suweijie/.workbuddy/binaries/python/envs/default/bin/python`（akshare 已安装）。
