// Spec: 009-market-quotes — 行情领域纯函数单测 (聚合 / 归一化 / 对齐 / 时效 / 常量表)

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  ASSET_CATEGORIES,
  DEFAULT_COMPARE_SYMBOLS,
  aggregate,
  alignSeries,
  bucketKey,
  changePct,
  formatPrice,
  isMarketStale,
  isPeriodDisabled,
  normalize,
  sliceRange,
  symbolsOfCategories,
  type Candle,
} from "./market";

const REF = new Date(2026, 8, 22); // 2026-09-22

function c(
  date: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number | null = 100,
): Candle {
  return { date, open, high, low, close, volume };
}

describe("aggregate — 四档粒度", () => {
  it("D 原样返回 (浅拷贝, 不改入参)", () => {
    const rows = [c("2026-09-21", 1, 2, 1, 2), c("2026-09-22", 2, 3, 2, 3)];
    const out = aggregate(rows, "D");
    assert.deepEqual(out, rows);
    assert.notEqual(out, rows, "应返回新数组");
  });

  it("月聚合: 首开 / 最高 / 最低 / 末收 / 量求和", () => {
    const rows = [c("2026-08-03", 10, 15, 9, 12, 100), c("2026-08-20", 12, 18, 11, 16, 200)];
    const out = aggregate(rows, "M");
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], {
      date: "2026-08-20", // 区间最后一个交易日
      open: 10,
      high: 18,
      low: 9,
      close: 16,
      volume: 300,
    });
  });

  it("年聚合: 跨年分组互不混淆", () => {
    const rows = [
      c("2025-06-02", 5, 8, 4, 7, 10),
      c("2025-12-30", 7, 9, 6, 8, 10),
      c("2026-03-02", 20, 30, 18, 25, 20),
    ];
    const out = aggregate(rows, "Y");
    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((r) => [r.date, r.open, r.close]),
      [
        ["2025-12-30", 5, 8],
        ["2026-03-02", 20, 25],
      ],
    );
  });

  it("周聚合: 跨年周不被年份切断 (2025-12-29 ~ 2026-01-02 同周)", () => {
    const rows = [
      c("2025-12-29", 1, 2, 1, 2, 10), // 周一
      c("2025-12-31", 2, 3, 2, 3, 10), // 周三
      c("2026-01-02", 3, 4, 3, 4, 10), // 周五 (跨年后)
      c("2026-01-05", 4, 5, 4, 5, 10), // 下一周周一
    ];
    const out = aggregate(rows, "W");
    assert.equal(out.length, 2, "跨年那几天必须落在同一根周 K 线");
    assert.deepEqual(out[0], {
      date: "2026-01-02",
      open: 1,
      high: 4,
      low: 1,
      close: 4,
      volume: 30,
    });
  });

  it("周界键取所在周的周一", () => {
    assert.equal(bucketKey("2025-12-29", "W"), "2025-12-29"); // 周一自身
    assert.equal(bucketKey("2026-01-01", "W"), "2025-12-29"); // 周四回溯到周一
    assert.equal(bucketKey("2026-01-04", "W"), "2025-12-29"); // 周日仍属该周
    assert.equal(bucketKey("2026-01-05", "W"), "2026-01-05"); // 下周一
    assert.equal(bucketKey("2026-09-22", "M"), "2026-09");
    assert.equal(bucketKey("2026-09-22", "Y"), "2026");
  });

  it("量: 任一子项缺失则整体为 null (不把 null 当 0 求和)", () => {
    const rows = [c("2026-08-03", 10, 15, 9, 12, null), c("2026-08-20", 12, 18, 11, 16, 200)];
    assert.equal(aggregate(rows, "M")[0].volume, null);
  });

  it("无 OHLC 的资产 (房价): 聚合后 open/high/low 仍为 null, close 取末值", () => {
    const rows: Candle[] = [
      { date: "2026-07-01", open: null, high: null, low: null, close: 100.5, volume: null },
      { date: "2026-08-01", open: null, high: null, low: null, close: 99.3, volume: null },
    ];
    const out = aggregate(rows, "Y");
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], {
      date: "2026-08-01",
      open: null,
      high: null,
      low: null,
      close: 99.3,
      volume: null,
    });
  });

  it("月频资产按 D 聚合时原样返回 (不伪造日频)", () => {
    const rows: Candle[] = [
      { date: "2026-07-01", open: null, high: null, low: null, close: 100.5, volume: null },
      { date: "2026-08-01", open: null, high: null, low: null, close: 99.3, volume: null },
    ];
    assert.deepEqual(aggregate(rows, "D"), rows);
  });
});

describe("normalize — 基准点恒为 100", () => {
  const rows = [
    c("2020-01-02", 1, 1, 1, 50),
    c("2020-06-01", 1, 1, 1, 75),
    c("2021-01-04", 1, 1, 1, 100),
  ];

  it("缺省以序列首点为基准, 起点为 100", () => {
    const out = normalize(rows);
    assert.deepEqual(out, [
      { date: "2020-01-02", value: 100 },
      { date: "2020-06-01", value: 150 },
      { date: "2021-01-04", value: 200 },
    ]);
  });

  it("指定基准日: 从该日起算, 起点仍为 100", () => {
    const out = normalize(rows, "2020-06-01");
    assert.equal(out.length, 2);
    assert.equal(out[0].value, 100);
    assert.equal(out[1].value, 133.33); // 100 / 75
  });

  it("基准日早于序列首点时取首点 (不抛错、不返回空)", () => {
    const out = normalize(rows, "2000-01-01");
    assert.equal(out.length, 3);
    assert.equal(out[0].value, 100);
  });

  it("基准值为 0 时返回 null 而非 Infinity", () => {
    const zero = [c("2020-01-02", 0, 0, 0, 0), c("2020-06-01", 0, 0, 0, 5)];
    const out = normalize(zero);
    assert.deepEqual(
      out.map((p) => p.value),
      [null, null],
    );
  });

  it("空序列返回空数组", () => {
    assert.deepEqual(normalize([]), []);
  });
});

describe("alignSeries — 并集 + 前向填充", () => {
  it("日期轴取并集, 中间缺口前向填充, 首点之前为 null", () => {
    const series = {
      a: [
        { date: "2026-01-01", value: 100 },
        { date: "2026-01-05", value: 110 },
      ],
      b: [
        { date: "2026-01-03", value: 100 },
        { date: "2026-01-05", value: 90 },
      ],
    };
    const { dates, aligned } = alignSeries(series);
    assert.deepEqual(dates, ["2026-01-01", "2026-01-03", "2026-01-05"]);
    assert.deepEqual(aligned.a, [100, 100, 110], "a 在 01-03 无数据, 应沿用前值");
    assert.deepEqual(aligned.b, [null, 100, 90], "b 在首点(01-03)之前必须为 null, 不用回填伪造");
  });

  it("各序列长度与日期轴一致", () => {
    const { dates, aligned } = alignSeries({
      x: [{ date: "2026-01-01", value: 100 }],
      y: [{ date: "2026-01-09", value: 100 }],
    });
    assert.equal(dates.length, 2);
    assert.equal(aligned.x.length, 2);
    assert.equal(aligned.y.length, 2);
    assert.deepEqual(aligned.x, [100, 100]);
    assert.deepEqual(aligned.y, [null, 100]);
  });

  it("空输入返回空轴", () => {
    const { dates, aligned } = alignSeries({});
    assert.deepEqual(dates, []);
    assert.deepEqual(aligned, {});
  });
});

describe("sliceRange — 窗口裁剪", () => {
  const rows: Candle[] = [
    c("2015-01-05", 1, 1, 1, 1),
    c("2024-09-02", 1, 1, 1, 2),
    c("2025-08-01", 1, 1, 1, 3),
    c("2025-10-08", 1, 1, 1, 4),
    c("2026-09-22", 1, 1, 1, 5),
  ];

  it("以最后一条数据日期为锚点向前推", () => {
    assert.deepEqual(
      sliceRange(rows, "1Y").map((r) => r.date),
      ["2025-10-08", "2026-09-22"],
    );
    assert.equal(sliceRange(rows, "3Y").length, 4); // 2023-09-22 起的 4 条
  });

  it("ALL 返回全部", () => {
    assert.equal(sliceRange(rows, "ALL").length, 5);
  });

  it("空序列不报错", () => {
    assert.deepEqual(sliceRange([], "1Y"), []);
  });
});

describe("isMarketStale — 时效判定", () => {
  it("日频容忍 5 个自然日", () => {
    assert.equal(isMarketStale("2026-09-21", "D", REF), false); // 1 天
    assert.equal(isMarketStale("2026-09-17", "D", REF), false); // 5 天, 边界内
    assert.equal(isMarketStale("2026-09-16", "D", REF), true); // 6 天
  });

  it("月频容忍 60 天 (统计局数据次月中旬发布, 留足发布延迟)", () => {
    assert.equal(isMarketStale("2026-08-01", "M", REF), false); // 52 天 — 8 月房价属正常口径
    assert.equal(isMarketStale("2026-07-01", "M", REF), true); // 83 天 — 7 月数据早已该发布
  });

  it("月频超过容忍受限则判滞后", () => {
    assert.equal(isMarketStale("2026-05-01", "M", REF), true); // 144 天
  });
});

describe("isPeriodDisabled — 月频资产禁用日/周", () => {
  it("月频只允许月/年", () => {
    assert.equal(isPeriodDisabled("M", "D"), true);
    assert.equal(isPeriodDisabled("M", "W"), true);
    assert.equal(isPeriodDisabled("M", "M"), false);
    assert.equal(isPeriodDisabled("M", "Y"), false);
  });

  it("日频不限", () => {
    assert.equal(isPeriodDisabled("D", "D"), false);
    assert.equal(isPeriodDisabled("D", "W"), false);
  });
});

describe("格式化与涨跌幅", () => {
  it("按资产精度格式化, 不做全局统一取整", () => {
    assert.equal(formatPrice(0.0991, 4), "0.0991"); // 狗狗币
    assert.equal(formatPrice(192.73, 1), "192.7"); // 房价指数
    assert.equal(formatPrice(2727.42, 2), "2,727.42"); // 以太坊
  });

  it("涨跌幅: 基准为 0 或缺值返回 null", () => {
    assert.equal(changePct(100, 110), 10);
    assert.equal(changePct(100, 90), -10);
    assert.equal(changePct(0, 10), null);
    assert.equal(changePct(null, 10), null);
    assert.equal(changePct(100, null), null);
  });
});

describe("常量表自检", () => {
  it("11 个资产, symbol 无重复", () => {
    const all = ASSET_CATEGORIES.flatMap((c) => [...c.symbols]);
    assert.equal(all.length, 11);
    assert.equal(new Set(all).size, 11);
  });

  it("categories 为空表示全部资产", () => {
    assert.equal(symbolsOfCategories(null).length, 11);
  });

  it("股票指数页覆盖美股 + 中国香港股 + A 股, 共 4 项", () => {
    assert.deepEqual(symbolsOfCategories(["us", "hk", "cn"]), ["dji", "ixic", "hsi", "sse"]);
  });

  it("合并图默认勾选的资产都存在于资产清单中", () => {
    const all = new Set(symbolsOfCategories(null));
    for (const s of DEFAULT_COMPARE_SYMBOLS) {
      assert.ok(all.has(s), `默认对比资产 ${s} 不在资产清单中`);
    }
    assert.ok(DEFAULT_COMPARE_SYMBOLS.length >= 2 && DEFAULT_COMPARE_SYMBOLS.length <= 11);
  });
});
