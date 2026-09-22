// Spec: 002-macro-alerts — 告警规则与评估纯函数 (domain 层, 无 IO)

import type { Indicator, SeriesPoint } from "@/domain/macro";

export type AlertSeverity = "warning" | "danger";
export type AlertStatus = "triggered" | "normal" | "no_data";

type RuleBase = {
  ruleId: string;
  indicatorKey: string;
  severity: AlertSeverity;
  /** 展示用规则名, 如 "制造业 PMI 跌破荣枯线" */
  label: string;
  /** 触发含义说明 */
  rationale: string;
};

export type AlertRule =
  | (RuleBase & { kind: "threshold"; op: "below" | "above"; threshold: number })
  | (RuleBase & { kind: "delta_drop"; threshold: number })
  | (RuleBase & { kind: "compare"; compareToKey: string });

export type AlertItem = {
  rule: AlertRule;
  status: AlertStatus;
  latest?: SeriesPoint;
  previous?: SeriesPoint;
  message: string;
};

/** 首批规则集 (spec 002 design.md 规则表), 顺序即展示顺序 */
export const ALERT_RULES: readonly AlertRule[] = [
  { ruleId: "gdp-slowdown", indicatorKey: "gdp_yoy", kind: "threshold", op: "below", threshold: 4.5, severity: "danger", label: "GDP 增速失速", rationale: "GDP 同比低于 4.5%，增长动能明显走弱" },
  { ruleId: "unemployment-high", indicatorKey: "unemployment", kind: "threshold", op: "above", threshold: 5.5, severity: "danger", label: "失业率过高", rationale: "城镇调查失业率高于 5.5% 警戒线" },
  { ruleId: "export-plunge", indicatorKey: "export_yoy", kind: "delta_drop", threshold: 5, severity: "danger", label: "出口骤降", rationale: "出口同比较上期回落超过 5 个百分点，外需骤降" },
  { ruleId: "pmi-below-50", indicatorKey: "pmi_mfg", kind: "threshold", op: "below", threshold: 50, severity: "warning", label: "制造业 PMI 跌破荣枯线", rationale: "制造业进入收缩区间" },
  { ruleId: "cpi-negative", indicatorKey: "cpi_yoy", kind: "threshold", op: "below", threshold: 0, severity: "warning", label: "CPI 同比为负", rationale: "消费端通缩压力" },
  { ruleId: "ppi-negative", indicatorKey: "ppi_yoy", kind: "threshold", op: "below", threshold: 0, severity: "warning", label: "PPI 同比为负", rationale: "工业品出厂价格下跌，企业盈利承压" },
  { ruleId: "m1-m2-scissor", indicatorKey: "m1_yoy", kind: "compare", compareToKey: "m2_yoy", severity: "warning", label: "M1-M2 剪刀差为负", rationale: "M1 增速低于 M2，资金活化不足、企业信心偏弱" },
  { ruleId: "house-price-negative", indicatorKey: "house_price_yoy", kind: "threshold", op: "below", threshold: 0, severity: "warning", label: "70 城房价同比为负", rationale: "新房价格整体下跌" },
] as const;

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function byKey(indicators: readonly Indicator[]): Map<string, Indicator> {
  return new Map(indicators.map((ind) => [ind.key, ind]));
}

/** 评估全部规则: 基于最新两个数据点, 无副作用 (spec 002 US-1) */
export function evaluateRules(
  rules: readonly AlertRule[],
  indicators: readonly Indicator[],
): AlertItem[] {
  const index = byKey(indicators);

  return rules.map((rule) => {
    const ind = index.get(rule.indicatorKey);
    if (!ind || ind.series.length === 0) {
      return { rule, status: "no_data", message: "暂无数据" };
    }
    const latest = ind.series[ind.series.length - 1];

    switch (rule.kind) {
      case "threshold": {
        const triggered =
          rule.op === "below" ? latest.value < rule.threshold : latest.value > rule.threshold;
        const cmp = rule.op === "below" ? "<" : ">";
        return {
          rule,
          status: triggered ? "triggered" : "normal",
          latest,
          message: triggered
            ? `${ind.name} ${fmt(latest.value)}（${latest.date}）${cmp} ${fmt(rule.threshold)}，${rule.rationale}`
            : `${ind.name} ${fmt(latest.value)}（${latest.date}），未触发（阈值 ${cmp} ${fmt(rule.threshold)}）`,
        };
      }
      case "delta_drop": {
        if (ind.series.length < 2) {
          return { rule, status: "no_data", message: "数据点不足，无法计算环比变化" };
        }
        const previous = ind.series[ind.series.length - 2];
        const delta = latest.value - previous.value;
        const triggered = delta <= -rule.threshold;
        return {
          rule,
          status: triggered ? "triggered" : "normal",
          latest,
          previous,
          message: triggered
            ? `${ind.name} 较上期回落 ${fmt(Math.abs(delta))} 个百分点（${fmt(previous.value)} → ${fmt(latest.value)}），${rule.rationale}`
            : `${ind.name} 较上期变化 ${delta >= 0 ? "+" : ""}${fmt(delta)}（${fmt(previous.value)} → ${fmt(latest.value)}），未触发`,
        };
      }
      case "compare": {
        const other = index.get(rule.compareToKey);
        if (!other || other.series.length === 0) {
          return { rule, status: "no_data", message: "对比指标暂无数据" };
        }
        const otherLatest = other.series[other.series.length - 1];
        const gap = latest.value - otherLatest.value;
        const triggered = gap < 0;
        return {
          rule,
          status: triggered ? "triggered" : "normal",
          latest,
          message: triggered
            ? `${ind.name} ${fmt(latest.value)} 低于 ${other.name} ${fmt(otherLatest.value)}（剪刀差 ${fmt(gap)}），${rule.rationale}`
            : `${ind.name} ${fmt(latest.value)} 高于 ${other.name} ${fmt(otherLatest.value)}（剪刀差 +${fmt(gap)}），未触发`,
        };
      }
    }
  });
}

/** 展示排序: triggered → normal → no_data; triggered 内 danger 在前; 同级保持规则表顺序 */
export function sortAlertItems(items: AlertItem[]): AlertItem[] {
  const statusOrder: Record<AlertStatus, number> = { triggered: 0, normal: 1, no_data: 2 };
  const severityOrder: Record<AlertSeverity, number> = { danger: 0, warning: 1 };
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const byStatus = statusOrder[a.item.status] - statusOrder[b.item.status];
      if (byStatus !== 0) return byStatus;
      if (a.item.status === "triggered") {
        const bySeverity = severityOrder[a.item.rule.severity] - severityOrder[b.item.rule.severity];
        if (bySeverity !== 0) return bySeverity;
      }
      return a.i - b.i;
    })
    .map(({ item }) => item);
}
