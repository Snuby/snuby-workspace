// Spec: 006-testing — 宏观领域纯函数单测 (时效判定)

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { latestPoint, lagMonths, isStale, describeIndicator, TREND_WINDOW } from "./macro";

const SEP_2026 = new Date(2026, 8, 22); // 2026-09-22

describe("lagMonths", () => {
  it("同月为 0，上月为 1", () => {
    assert.equal(lagMonths("2026-09", SEP_2026), 0);
    assert.equal(lagMonths("2026-08", SEP_2026), 1);
  });

  it("跨年计算正确", () => {
    assert.equal(lagMonths("2025-08", SEP_2026), 13);
    assert.equal(lagMonths("2026-01", SEP_2026), 8);
  });

  it("兼容 YYYY-MM-DD 与 YYYY-MM 两种格式", () => {
    assert.equal(lagMonths("2026-08-20", SEP_2026), 1);
    assert.equal(lagMonths("2026-08", SEP_2026), 1);
  });

  it("月份非法时按年末处理，不产生 NaN", () => {
    assert.ok(Number.isFinite(lagMonths("2026", SEP_2026)));
    assert.ok(Number.isFinite(lagMonths("2026-99", SEP_2026)));
  });
});

describe("isStale", () => {
  it("月度容忍 3 个月：滞后 2 个月算新鲜，3 个月算滞后", () => {
    assert.equal(isStale("2026-07", "月度", SEP_2026), false);
    assert.equal(isStale("2026-06", "月度", SEP_2026), true);
  });

  it("季度容忍 6 个月：当季披露（Q2 数据）不算滞后", () => {
    assert.equal(isStale("2026-06", "季度", SEP_2026), false); // 滞后 3 个月
    assert.equal(isStale("2026-03", "季度", SEP_2026), true); // 滞后 6 个月
  });

  it("半年度容忍 8 个月", () => {
    assert.equal(isStale("2026-06", "半年度", SEP_2026), false);
    assert.equal(isStale("2025-12", "半年度", SEP_2026), true);
  });

  it("未知频率按月度口径处理", () => {
    assert.equal(isStale("2026-06", "不存在的频率", SEP_2026), true);
  });
});

describe("latestPoint", () => {
  it("取序列末位", () => {
    assert.deepEqual(latestPoint([{ date: "2026-01", value: 1 }, { date: "2026-02", value: 2 }]), {
      date: "2026-02",
      value: 2,
    });
  });

  it("空序列返回 null", () => {
    assert.equal(latestPoint([]), null);
  });
});

describe("describeIndicator", () => {
  it("已覆盖全部现行指标 key（26 宏观 + 10 行业）", () => {
    const keys = [
      "gdp_yoy", "gdp_secondary", "gdp_tertiary", "fiscal_revenue_yoy", "ind_yoy",
      "cpi_yoy", "ppi_yoy", "pmi_mfg", "pmi_non_mfg", "unemployment", "boom_index",
      "consumer_confidence", "retail_yoy", "fdi_yoy", "m1_yoy", "m2_yoy", "shrzgm",
      "new_loans", "lpr_1y", "lpr_5y", "export_yoy", "import_yoy", "trade_balance",
      "fx_reserves", "real_estate_index", "house_price_yoy",
      "lpi_index", "pax_load_factor", "freight_rail_yoy", "freight_highway_yoy",
      "elec_yoy", "elec_secondary_yoy", "elec_tertiary_yoy",
      "commodity_price_index", "agri_price_index", "construction_index",
    ];
    const missing = keys.filter((k) => describeIndicator(k) === "");
    assert.deepEqual(missing, [], `缺少口径说明: ${missing.join(", ")}`);
    assert.equal(keys.length, 36);
  });

  it("未知 key 返回空串", () => {
    assert.equal(describeIndicator("not_a_key"), "");
  });
});

describe("TREND_WINDOW", () => {
  it("为 36 期（近 3 年月度窗口）", () => {
    assert.equal(TREND_WINDOW, 36);
  });
});
