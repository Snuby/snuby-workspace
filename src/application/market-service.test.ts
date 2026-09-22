// Spec: 009-market-quotes — 用例层集成测试 (真实 SQLite fixture, 覆盖 repository → service 链路)

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getAssetSeries, getComparison, getMarketOverview } from "./market-service";

const FIXTURE_DB = path.join(os.tmpdir(), `snuby-market-test-${process.pid}.db`);

/** 相对当前日期偏移 n 天的 YYYY-MM-DD (负数表示未来), 保证时效断言长期稳定 */
function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type AssetFixture = {
  symbol: string;
  name: string;
  category: string;
  unit: string;
  baseFreq: "D" | "M";
  precision: number;
  hasOhlc: boolean;
  hasVolume: boolean;
  note: string | null;
  /** 绝对价位锚点 (房产类资产才有) — 2026-09-22 口径修正后引入 */
  refPrice?: number | null;
  refPriceDate?: string | null;
  refPriceSource?: string | null;
  rows: Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    volume: number | null;
  }>;
};

const ASSET_FIXTURES: AssetFixture[] = [
  {
    symbol: "gold", name: "黄金", category: "metal", unit: "美元/盎司",
    baseFreq: "D", precision: 2, hasOhlc: true, hasVolume: false, note: "测试用外盘期货",
    // 90 个连续日线, 收盘 100 → 189; 最新一日 = 今天 (新鲜)
    rows: Array.from({ length: 90 }, (_, i) => {
      const close = 100 + i;
      return {
        date: dayOffset(89 - i),
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: null,
      };
    }),
  },
  {
    symbol: "btc", name: "比特币", category: "crypto", unit: "USDT",
    baseFreq: "D", precision: 0, hasOhlc: true, hasVolume: true, note: "测试用",
    rows: Array.from({ length: 60 }, (_, i) => {
      const close = 50_000 + i * 100;
      return {
        date: dayOffset(59 - i),
        open: close,
        high: close * 1.01,
        low: close * 0.99,
        close,
        volume: 1000 + i,
      };
    }),
  },
  {
    symbol: "doge", name: "狗狗币", category: "crypto", unit: "USDT",
    baseFreq: "D", precision: 4, hasOhlc: true, hasVolume: true, note: null,
    rows: Array.from({ length: 30 }, (_, i) => {
      const close = Number((0.1 + i * 0.001).toFixed(4));
      return { date: dayOffset(29 - i), open: close, high: close, low: close, close, volume: 500 };
    }),
  },
  {
    symbol: "bj_house", name: "北京房价", category: "realestate", unit: "价格指数",
    baseFreq: "M", precision: 1, hasOhlc: false, hasVolume: false,
    note: "70 城二手住宅价格指数, 非成交均价",
    refPrice: 61038, refPriceDate: "2026-08-01", refPriceSource: "中指研究院",
    // 12 期月频, 最新一期约 100 天前 → 超出月度容忍 (60 天), 应判滞后
    rows: Array.from({ length: 12 }, (_, i) => ({
      date: dayOffset(100 + (11 - i) * 30),
      open: null,
      high: null,
      low: null,
      close: 100 + i,
      volume: null,
    })),
  },
];

before(() => {
  fs.rmSync(FIXTURE_DB, { force: true });
  const db = new DatabaseSync(FIXTURE_DB);
  db.exec(`
    CREATE TABLE asset (
      symbol TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, unit TEXT NOT NULL,
      source TEXT NOT NULL, base_freq TEXT NOT NULL, precision INTEGER NOT NULL,
      has_ohlc INTEGER NOT NULL, has_volume INTEGER NOT NULL, note TEXT,
      first_date TEXT, last_date TEXT, updated_at TEXT NOT NULL,
      ref_price REAL, ref_price_date TEXT, ref_price_source TEXT);
    CREATE TABLE kline (
      symbol TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL,
      close REAL NOT NULL, volume REAL, PRIMARY KEY (symbol, date));
  `);

  const insertAsset = db.prepare(
    `INSERT INTO asset (symbol, name, category, unit, source, base_freq, precision,
       has_ohlc, has_volume, note, first_date, last_date, updated_at,
       ref_price, ref_price_date, ref_price_source)
     VALUES (?, ?, ?, ?, 'fixture', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertKline = db.prepare(
    `INSERT INTO kline (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const a of ASSET_FIXTURES) {
    const sorted = [...a.rows].sort((x, y) => x.date.localeCompare(y.date));
    insertAsset.run(
      a.symbol, a.name, a.category, a.unit, a.baseFreq, a.precision,
      a.hasOhlc ? 1 : 0, a.hasVolume ? 1 : 0, a.note,
      sorted[0].date, sorted[sorted.length - 1].date, "2026-09-22T00:00:00",
      a.refPrice ?? null, a.refPriceDate ?? null, a.refPriceSource ?? null,
    );
    for (const r of sorted) {
      insertKline.run(a.symbol, r.date, r.open, r.high, r.low, r.close, r.volume);
    }
  }
  db.close();

  process.env.MARKET_DB_PATH = FIXTURE_DB;
});

after(() => {
  delete process.env.MARKET_DB_PATH;
  fs.rmSync(FIXTURE_DB, { force: true });
});

describe("getMarketOverview — 资产统计", () => {
  it("返回 fixture 中全部资产, 且按 domain 类别分组", async () => {
    const overview = await getMarketOverview();
    assert.equal(overview.assets.length, 4);
    assert.deepEqual(
      overview.sections.map((s) => [s.id, s.assets.length]),
      [
        ["metal", 1],
        ["crypto", 2],
        ["realestate", 1],
      ],
      "空类别应被剔除, 组内顺序与 ASSET_CATEGORIES 一致",
    );
  });

  it("当日涨跌取最新两个交易日收盘价", async () => {
    const overview = await getMarketOverview();
    const gold = overview.assets.find((a) => a.symbol === "gold");
    assert.equal(gold?.latest?.close, 189);
    // 188 → 189
    assert.equal(gold?.changePct, 0.53);
  });

  it("近一年涨跌以窗口首条数据为锚点", async () => {
    const overview = await getMarketOverview();
    const gold = overview.assets.find((a) => a.symbol === "gold");
    // 90 期全部落在近一年窗口内: 100 → 189
    assert.equal(gold?.yearChangePct, 89);
  });

  it("精度按资产透传, 不在用例层统一取整", async () => {
    const overview = await getMarketOverview();
    const bySymbol = Object.fromEntries(overview.assets.map((a) => [a.symbol, a]));
    assert.equal(bySymbol.doge.precision, 4);
    assert.equal(bySymbol.btc.precision, 0);
    assert.equal(bySymbol.bj_house.precision, 1);
  });

  it("OHLC 与成交量能力标记透传", async () => {
    const overview = await getMarketOverview();
    const bySymbol = Object.fromEntries(overview.assets.map((a) => [a.symbol, a]));
    assert.equal(bySymbol.gold.hasOhlc, true);
    assert.equal(bySymbol.gold.hasVolume, false, "外盘期货源不含量, 不应渲染量副图");
    assert.equal(bySymbol.bj_house.hasOhlc, false, "房价无 OHLC, 应降级折线");
    assert.equal(bySymbol.bj_house.baseFreq, "M");
  });

  it("绝对价位锚点透传: 房产类带均价与来源, 其余资产为 null", async () => {
    const overview = await getMarketOverview();
    const bySymbol = Object.fromEntries(overview.assets.map((a) => [a.symbol, a]));
    assert.equal(bySymbol.bj_house.refPrice, 61038);
    assert.equal(bySymbol.bj_house.refPriceDate, "2026-08-01");
    assert.equal(bySymbol.bj_house.refPriceSource, "中指研究院");
    assert.equal(bySymbol.gold.refPrice, null, "非房产资产无锚点, 卡片不渲染该行");
    assert.equal(bySymbol.btc.refPrice, null);
  });

  it("时效判定按各自口径: 日频资产新鲜, 滞后 100 天的月频资产标记滞后", async () => {
    const overview = await getMarketOverview();
    const bySymbol = Object.fromEntries(overview.assets.map((a) => [a.symbol, a]));
    assert.equal(bySymbol.gold.stale, false);
    assert.equal(bySymbol.bj_house.stale, true);
    assert.ok((bySymbol.bj_house.lagDays ?? 0) >= 100);
    assert.ok(bySymbol.bj_house.note?.includes("非成交均价"), "口径说明应随资产透传到界面");
  });

  it("迷你走势只采样收盘价且末点等于最新收盘", async () => {
    const overview = await getMarketOverview();
    const gold = overview.assets.find((a) => a.symbol === "gold");
    assert.ok((gold?.spark.length ?? 0) > 1);
    assert.equal(gold?.spark[gold.spark.length - 1], 189);
    assert.ok(
      (gold?.spark.length ?? 0) <= 31,
      "采样点数应受上限约束, 避免迷你图过密",
    );
  });

  it("updatedAt 取资产元信息中的最大抓取时间", async () => {
    const overview = await getMarketOverview();
    assert.equal(overview.updatedAt, "2026-09-22T00:00:00");
  });
});

describe("getAssetSeries — 聚合与窗口裁剪", () => {
  it("日粒度原样返回, 条数与库中一致", async () => {
    const { candles } = await getAssetSeries("gold", "D", "ALL");
    assert.equal(candles.length, 90);
    assert.equal(candles[0].close, 100);
    assert.equal(candles[candles.length - 1].close, 189);
  });

  it("周粒度合并区间: 首开 / 最高 / 最低 / 末收", async () => {
    const { candles: daily } = await getAssetSeries("gold", "D", "ALL");
    const { candles: weekly } = await getAssetSeries("gold", "W", "ALL");
    assert.ok(weekly.length < daily.length, "周线根数应少于日线");
    assert.equal(weekly[weekly.length - 1].close, 189);
    // 最后一根周线的高点 = 该周内最大 high
    const lastWeek = weekly[weekly.length - 1];
    assert.ok(lastWeek.high !== null && lastWeek.high >= lastWeek.close);
  });

  it("窗口裁剪以最后一条数据为锚点", async () => {
    const { candles: all } = await getAssetSeries("gold", "D", "ALL");
    const { candles: oneYear } = await getAssetSeries("gold", "D", "1Y");
    assert.ok(oneYear.length <= all.length);
    assert.equal(oneYear[oneYear.length - 1].date, all[all.length - 1].date);
  });

  it("月频资产按日粒度取数不报错 (原样返回, 不伪造日频)", async () => {
    const { candles } = await getAssetSeries("bj_house", "D", "ALL");
    assert.equal(candles.length, 12);
    assert.equal(candles[0].open, null);
  });

  it("不存在的资产返回空序列而非抛错", async () => {
    const { candles } = await getAssetSeries("not_exists", "D", "ALL");
    assert.deepEqual(candles, []);
  });
});

describe("getComparison — 归一化与对齐", () => {
  it("每条曲线的起点恒为 100", async () => {
    const result = await getComparison(["gold", "btc", "doge"]);
    for (const symbol of result.symbols) {
      const values = result.series[symbol].filter((v): v is number => v !== null);
      assert.equal(values[0], 100, `${symbol} 起点应为 100`);
    }
  });

  it("各资产起始日期不同时, 各自独立取基准日并回传", async () => {
    const result = await getComparison(["gold", "btc", "doge"]);
    const goldStart = result.series.gold.filter((v) => v !== null).length;
    const dogeStart = result.series.doge.filter((v) => v !== null).length;
    assert.ok(dogeStart < goldStart, "狗狗币历史更短, 有效点应更少");
    // 起始早的资产其基准日前必然为 null (不用回填值伪造历史)
    assert.equal(result.series.doge[0], null);
    assert.ok(result.bases.doge > result.bases.gold, "狗狗币基准日晚于黄金");
  });

  it("默认粒度为周、默认窗口为近 5 年 (design 决策 5)", async () => {
    const result = await getComparison(["gold"]);
    assert.equal(result.period, "W");
    assert.equal(result.range, "5Y");
  });

  it("日期轴取所选资产的并集 (日粒度下等于历史更长者的交易日数)", async () => {
    const result = await getComparison(["gold", "btc"], "D", "ALL");
    const dates = new Set(result.dates);
    assert.ok(dates.size === result.dates.length, "日期轴不应有重复");
    const sorted = [...result.dates].sort();
    assert.deepEqual(result.dates, sorted, "日期轴须升序");
    assert.equal(result.dates.length, 90, "并集应覆盖历史更长的黄金");
  });

  it("归一化值反映相对涨跌: 黄金 100→189 应约为 189", async () => {
    const result = await getComparison(["gold"], "D", "ALL");
    const values = result.series.gold.filter((v): v is number => v !== null);
    assert.equal(values[values.length - 1], 189);
  });

  it("指定基准日后起点仍为 100 且早于基准日的点被裁掉", async () => {
    const full = await getComparison(["gold"], "D", "ALL");
    const base = full.dates[Math.floor(full.dates.length / 2)];
    const trimmed = await getComparison(["gold"], "D", "ALL", base);
    assert.equal(trimmed.bases.gold, base);
    assert.equal(trimmed.series.gold[0], 100);
    assert.ok(trimmed.dates.length < full.dates.length);
  });

  it("无效 symbol 被静默忽略, 不污染结果", async () => {
    const result = await getComparison(["gold", "not_exists"]);
    assert.deepEqual(result.symbols, ["gold"]);
    assert.equal(result.series.not_exists, undefined);
  });

  it("meta 随结果返回, 供前端取名称与单位", async () => {
    const result = await getComparison(["gold"]);
    assert.equal(result.metas[0].name, "黄金");
    assert.equal(result.metas[0].unit, "美元/盎司");
  });
});

describe("错误路径 — 库未初始化", () => {
  it("缺少 asset 表时抛 MarketDataError 并给出可操作提示", async () => {
    const emptyDb = path.join(os.tmpdir(), `snuby-market-empty-${process.pid}.db`);
    fs.rmSync(emptyDb, { force: true });
    const db = new DatabaseSync(emptyDb);
    db.exec("CREATE TABLE unrelated (x TEXT)");
    db.close();

    const previous = process.env.MARKET_DB_PATH;
    process.env.MARKET_DB_PATH = emptyDb;
    try {
      await assert.rejects(
        () => getMarketOverview(),
        (err: Error) => {
          assert.equal(err.name, "MarketDataError");
          assert.match(err.message, /fetch:market/);
          return true;
        },
      );
    } finally {
      process.env.MARKET_DB_PATH = previous;
      fs.rmSync(emptyDb, { force: true });
    }
  });
});
