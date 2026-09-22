// Spec: 007-integration-tests — 用例层集成测试 (真实 SQLite fixture, 覆盖 repository → service 链路)

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getMacroDashboard, getIndustryDashboard } from "./macro-service";
import { getAlertsReport } from "./alert-service";

const FIXTURE_DB = path.join(os.tmpdir(), `snuby-test-${process.pid}.db`);

/** 相对当前月份偏移 n 个月的 YYYY-MM (负数表示过去), 保证时效断言长期稳定 */
function monthOffset(n: number): string {
  const d = new Date();
  const total = d.getFullYear() * 12 + d.getMonth() - n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** 生成 n 期序列, 最后一期为 now - latestOffset 个月 */
function series(n: number, base: number, step: number, latestOffset: number) {
  return Array.from({ length: n }, (_, i) => {
    const offset = latestOffset + (n - 1 - i);
    return { date: monthOffset(offset), value: base + i * step };
  });
}

type Fixture = {
  key: string;
  name: string;
  unit: string;
  freq: string;
  dim: string;
  rows: Array<{ date: string; value: number }>;
};

const FIXTURES: Fixture[] = [
  // 触发 pmi-below-50 (threshold below 50): 最新期 49.8
  { key: "pmi_mfg", name: "制造业 PMI", unit: "", freq: "月度", dim: "confidence",
    rows: series(6, 48.8, 0.2, 1) },
  // 触发 m1-m2-scissor (compare)
  { key: "m1_yoy", name: "M1 同比", unit: "%", freq: "月度", dim: "money",
    rows: series(4, 3.5, 0.2, 1) },
  { key: "m2_yoy", name: "M2 同比", unit: "%", freq: "月度", dim: "money",
    rows: series(4, 7.0, 0.2, 1) },
  // 触发 export-plunge (delta_drop >= 5pct)
  { key: "export_yoy", name: "出口金额当月同比", unit: "%", freq: "月度", dim: "trade",
    rows: [
      { date: monthOffset(2), value: 12.0 },
      { date: monthOffset(1), value: 5.0 },
    ] },
  // 未触发: CPI 为正
  { key: "cpi_yoy", name: "CPI 同比", unit: "%", freq: "月度", dim: "price",
    rows: series(4, 0.6, 0.1, 1) },
  // 故意缺失: ppi_yoy 不在 fixture 中 -> ppi-negative 规则应为 no_data
  { key: "unemployment", name: "城镇调查失业率", unit: "%", freq: "月度", dim: "confidence",
    rows: series(4, 5.0, 0.0, 1) },
  { key: "house_price_yoy", name: "70城新房价格指数同比(均值)", unit: "%", freq: "月度", dim: "realestate",
    rows: series(4, 0.3, 0.0, 1) },
  // 触发 gdp-slowdown (danger) 且数据源滞后 (季度, 滞后 6 个月 -> 判定滞后)
  { key: "gdp_yoy", name: "GDP 同比增速", unit: "%", freq: "季度", dim: "growth",
    rows: [{ date: monthOffset(6), value: 4.0 }, { date: monthOffset(9), value: 4.4 }] },
  // 行业指标, 50 期用于验证趋势窗口裁剪
  { key: "elec_yoy", name: "全社会用电量同比", unit: "%", freq: "月度", dim: "industry",
    rows: series(50, 3.0, 0.05, 1) },
];

function writeFixture(): void {
  fs.rmSync(FIXTURE_DB, { force: true });
  const db = new DatabaseSync(FIXTURE_DB);
  db.exec(`
    CREATE TABLE series (indicator TEXT NOT NULL, date TEXT NOT NULL, value REAL, PRIMARY KEY (indicator, date));
    CREATE TABLE meta (indicator TEXT PRIMARY KEY, name TEXT, unit TEXT, freq TEXT, dim TEXT, updated_at TEXT);
  `);
  const insertSeries = db.prepare("INSERT INTO series (indicator, date, value) VALUES (?, ?, ?)");
  const insertMeta = db.prepare(
    "INSERT INTO meta (indicator, name, unit, freq, dim, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const f of FIXTURES) {
    for (const r of f.rows) insertSeries.run(f.key, r.date, r.value);
    insertMeta.run(f.key, f.name, f.unit, f.freq, f.dim, "2026-09-22T00:00:00");
  }
  db.close();
}

before(() => {
  writeFixture();
  process.env.MACRO_DB_PATH = FIXTURE_DB;
});

after(() => {
  fs.rmSync(FIXTURE_DB, { force: true });
  delete process.env.MACRO_DB_PATH;
});

describe("getMacroDashboard — SQLite → 视图模型", () => {
  it("指标总数与分组来自 meta 表", async () => {
    const dashboard = await getMacroDashboard();
    const total = dashboard.sections.reduce((n, s) => n + s.indicators.length, 0);
    assert.equal(total, FIXTURES.length);
    assert.ok(dashboard.groups.some((g) => g.id === "industry"));
  });

  it("趋势序列裁剪到 TREND_WINDOW=36 (行业指标给了 50 期)", async () => {
    const dashboard = await getMacroDashboard();
    const elec = dashboard.sections
      .flatMap((s) => s.indicators)
      .find((i) => i.key === "elec_yoy");
    assert.ok(elec);
    assert.equal(elec.trend.length, 36);
    assert.equal(elec.series.length, 50, "完整序列保留在 series 上");
  });

  it("latest 取裁剪后序列末位, 与数据库最新日期一致", async () => {
    const dashboard = await getMacroDashboard();
    const pmi = dashboard.sections.flatMap((s) => s.indicators).find((i) => i.key === "pmi_mfg");
    assert.equal(pmi?.latest?.date, monthOffset(1));
  });

  it("staleCount 只统计超容忍度的指标 (gdp_yoy 季度滞后 6 个月)", async () => {
    const dashboard = await getMacroDashboard();
    assert.equal(dashboard.staleCount, 1);
    const gdp = dashboard.sections.flatMap((s) => s.indicators).find((i) => i.key === "gdp_yoy");
    assert.equal(gdp?.lag, 6);
    const cpi = dashboard.sections.flatMap((s) => s.indicators).find((i) => i.key === "cpi_yoy");
    assert.equal(cpi?.lag, null, "新鲜指标 lag 为 null");
  });

  it("口径说明由领域字典注入 (非空)", async () => {
    const dashboard = await getMacroDashboard();
    for (const ind of dashboard.sections.flatMap((s) => s.indicators)) {
      assert.notEqual(ind.description, "", `${ind.key} 缺少口径说明`);
    }
  });

  it("updatedAt 来自 meta.updated_at", async () => {
    const dashboard = await getMacroDashboard();
    assert.equal(dashboard.updatedAt, "2026-09-22T00:00:00");
  });
});

describe("getIndustryDashboard — 分组过滤", () => {
  it("只返回 industry 分组", async () => {
    const dashboard = await getIndustryDashboard();
    assert.equal(dashboard.sections.length, 1);
    assert.equal(dashboard.sections[0].group.id, "industry");
    assert.equal(dashboard.sections[0].indicators.length, 1);
  });

  it("staleCount 按行业指标自身计算 (无滞后项)", async () => {
    const dashboard = await getIndustryDashboard();
    assert.equal(dashboard.staleCount, 0);
  });
});

describe("getAlertsReport — 端到端评估", () => {
  it("按 fixture 得到预期的触发项与排序 (danger 优先, 同级按规则表顺序)", async () => {
    const report = await getAlertsReport();
    const triggered = report.items.filter((i) => i.status === "triggered").map((i) => i.ruleId);
    assert.deepEqual(triggered, ["gdp-slowdown", "export-plunge", "pmi-below-50", "m1-m2-scissor"]);
    assert.equal(report.summary.triggered, 4);
    assert.equal(report.summary.danger, 2, "gdp-slowdown 与 export-plunge 为 danger");
    assert.equal(report.summary.warning, 2);
    assert.equal(report.summary.normal, 3);
    assert.equal(report.summary.noData, 1, "fixture 缺少 ppi_yoy -> 该规则无数据");
  });

  it("fixture 中缺失的指标在页面上呈现为 no_data 而非报错", async () => {
    const report = await getAlertsReport();
    const ppi = report.items.find((i) => i.ruleId === "ppi-negative");
    assert.equal(ppi?.status, "no_data");
    assert.equal(ppi?.message, "暂无数据");
    assert.equal(ppi?.latest, null);
  });

  it("summary 各状态计数之和等于规则总数", async () => {
    const report = await getAlertsReport();
    const { triggered, normal, noData } = report.summary;
    assert.equal(triggered + normal + noData, report.items.length);
  });

  it("依赖滞后指标的规则带上 lag 标注 (gdp-slowdown)", async () => {
    const report = await getAlertsReport();
    const gdp = report.items.find((i) => i.ruleId === "gdp-slowdown");
    assert.equal(gdp?.lag, 6);
    const pmi = report.items.find((i) => i.ruleId === "pmi-below-50");
    assert.equal(pmi?.lag, null);
  });

  it("指标名来自 meta.name, 消息含最新值与日期", async () => {
    const report = await getAlertsReport();
    const pmi = report.items.find((i) => i.ruleId === "pmi-below-50");
    assert.equal(pmi?.indicatorName, "制造业 PMI");
    assert.match(pmi?.message ?? "", /制造业 PMI 49\.8/);
  });
});

describe("错误处理", () => {
  it("数据库不存在时抛 MacroDataError (不返回半成品数据)", async () => {
    const original = process.env.MACRO_DB_PATH;
    process.env.MACRO_DB_PATH = path.join(os.tmpdir(), "snuby-not-exist.db");
    try {
      await assert.rejects(() => getMacroDashboard(), (err: Error) => {
        assert.equal(err.name, "MacroDataError");
        return true;
      });
      await assert.rejects(() => getAlertsReport(), (err: Error) => {
        assert.equal(err.name, "MacroDataError");
        return true;
      });
    } finally {
      process.env.MACRO_DB_PATH = original;
    }
  });
});
