// Spec: 006-testing — 告警规则评估与排序单测 (spec 002 核心逻辑)

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  ALERT_RULES,
  evaluateRules,
  sortAlertItems,
  type AlertRule,
} from "./alerts";
import type { Indicator } from "./macro";

function indicator(key: string, values: number[], freq = "月度"): Indicator {
  return {
    key,
    name: key,
    unit: "",
    freq,
    group: "growth",
    description: "",
    series: values.map((v, i) => ({
      date: `2026-${String(i + 1).padStart(2, "0")}`,
      value: v,
    })),
  };
}

describe("evaluateRules — threshold", () => {
  const rule: AlertRule = {
    ruleId: "t-below",
    indicatorKey: "x",
    kind: "threshold",
    op: "below",
    threshold: 50,
    severity: "warning",
    label: "测试规则",
    rationale: "低于阈值",
  };

  it("低于阈值触发", () => {
    const [item] = evaluateRules([rule], [indicator("x", [49.8])]);
    assert.equal(item.status, "triggered");
    assert.match(item.message, /49\.8/);
  });

  it("等于阈值不触发（严格小于）", () => {
    const [item] = evaluateRules([rule], [indicator("x", [50])]);
    assert.equal(item.status, "normal");
  });

  it("above 方向语义相反", () => {
    const above: AlertRule = { ...rule, ruleId: "t-above", op: "above", threshold: 5.5 };
    assert.equal(evaluateRules([above], [indicator("x", [5.6])])[0].status, "triggered");
    assert.equal(evaluateRules([above], [indicator("x", [5.4])])[0].status, "normal");
  });

  it("指标缺失或无数据点 -> no_data", () => {
    assert.equal(evaluateRules([rule], [])[0].status, "no_data");
    assert.equal(evaluateRules([rule], [indicator("y", [1])])[0].status, "no_data");
  });
});

describe("evaluateRules — delta_drop", () => {
  const rule: AlertRule = {
    ruleId: "d-drop",
    indicatorKey: "export_yoy",
    kind: "delta_drop",
    threshold: 5,
    severity: "danger",
    label: "出口骤降",
    rationale: "环比回落",
  };

  it("回落达到阈值触发", () => {
    const [item] = evaluateRules([rule], [indicator("export_yoy", [10, 5])]);
    assert.equal(item.status, "triggered");
  });

  it("回落不足阈值不触发", () => {
    assert.equal(evaluateRules([rule], [indicator("export_yoy", [10, 6])])[0].status, "normal");
  });

  it("上升不触发", () => {
    assert.equal(evaluateRules([rule], [indicator("export_yoy", [5, 10])])[0].status, "normal");
  });

  it("仅一个数据点 -> no_data", () => {
    assert.equal(evaluateRules([rule], [indicator("export_yoy", [10])])[0].status, "no_data");
  });
});

describe("evaluateRules — compare", () => {
  const rule: AlertRule = {
    ruleId: "c-scissor",
    indicatorKey: "m1_yoy",
    kind: "compare",
    compareToKey: "m2_yoy",
    severity: "warning",
    label: "M1-M2 剪刀差为负",
    rationale: "资金活化不足",
  };

  it("M1 低于 M2 触发，并给出剪刀差", () => {
    const items = evaluateRules(
      [rule],
      [indicator("m1_yoy", [4.1]), indicator("m2_yoy", [7.5])],
    );
    assert.equal(items[0].status, "triggered");
    assert.match(items[0].message, /-3\.4/);
  });

  it("M1 高于 M2 不触发", () => {
    const items = evaluateRules(
      [rule],
      [indicator("m1_yoy", [8]), indicator("m2_yoy", [7.5])],
    );
    assert.equal(items[0].status, "normal");
  });

  it("对比指标缺失 -> no_data", () => {
    const items = evaluateRules([rule], [indicator("m1_yoy", [4.1])]);
    assert.equal(items[0].status, "no_data");
  });
});

describe("sortAlertItems", () => {
  it("status 优先（triggered → normal → no_data），同级 danger 在前，其余保持规则表顺序", () => {
    const rules: AlertRule[] = [
      { ruleId: "n1", indicatorKey: "b", kind: "threshold", op: "below", threshold: 0, severity: "warning", label: "正常项", rationale: "" },
      { ruleId: "d1", indicatorKey: "c", kind: "threshold", op: "below", threshold: 100, severity: "warning", label: "触发-关注", rationale: "" },
      { ruleId: "x1", indicatorKey: "missing", kind: "threshold", op: "below", threshold: 0, severity: "warning", label: "无数据", rationale: "" },
      { ruleId: "d2", indicatorKey: "c", kind: "threshold", op: "below", threshold: 100, severity: "danger", label: "触发-严重", rationale: "" },
    ];
    const items = evaluateRules(rules, [indicator("b", [1]), indicator("c", [0])]);
    const sorted = sortAlertItems(items).map((i) => i.rule.ruleId);

    assert.deepEqual(sorted, ["d2", "d1", "n1", "x1"]);
    assert.equal(sorted.length, rules.length, "排序不丢失条目");
  });
});

describe("ALERT_RULES 规则表", () => {
  it("ruleId 唯一，且严重级别合法", () => {
    const ids = ALERT_RULES.map((r) => r.ruleId);
    assert.equal(new Set(ids).size, ids.length);
    for (const r of ALERT_RULES) {
      assert.ok(["warning", "danger"].includes(r.severity), `${r.ruleId} 级别非法`);
      assert.ok(r.label.length > 0 && r.rationale.length > 0, `${r.ruleId} 缺少 label/rationale`);
    }
  });

  it("规则全部能对上指标 key（避免改了 key 后规则静默失败）", () => {
    const known = new Set([
      "pmi_mfg", "cpi_yoy", "ppi_yoy", "m1_yoy", "m2_yoy",
      "unemployment", "house_price_yoy", "export_yoy", "gdp_yoy",
    ]);
    for (const r of ALERT_RULES) {
      assert.ok(known.has(r.indicatorKey), `未知指标: ${r.indicatorKey}`);
    }
  });
});
