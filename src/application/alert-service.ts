// Spec: 002-macro-alerts — 跟踪提醒用例 (评估 → 排序 → 视图模型)

import {
  ALERT_RULES,
  evaluateRules,
  sortAlertItems,
  type AlertItem,
  type AlertSeverity,
  type AlertStatus,
} from "@/domain/alerts";
import { isStale, lagMonths } from "@/domain/macro";
import { loadIndicators } from "@/infrastructure/sqlite-macro-repository";

export type AlertView = {
  ruleId: string;
  label: string;
  indicatorKey: string;
  indicatorName: string;
  status: AlertStatus;
  severity: AlertSeverity;
  latest: { date: string; value: number } | null;
  message: string;
  /** 该规则所依赖指标的数据源滞后月数 (未滞后为 null) — spec 004 */
  lag: number | null;
};

export type AlertSummary = {
  triggered: number;
  danger: number;
  warning: number;
  normal: number;
  noData: number;
};

export type AlertsReport = {
  updatedAt: string;
  summary: AlertSummary;
  items: AlertView[];
};

export async function getAlertsReport(): Promise<AlertsReport> {
  const { indicators, updatedAt } = await loadIndicators();
  const nameOf = new Map(indicators.map((ind) => [ind.key, ind.name]));
  const freqOf = new Map(indicators.map((ind) => [ind.key, ind.freq]));

  const sorted = sortAlertItems(evaluateRules(ALERT_RULES, indicators));
  const items = sorted.map((item: AlertItem) => {
    const freq = freqOf.get(item.rule.indicatorKey) ?? "月度";
    const stale = item.latest !== undefined && isStale(item.latest.date, freq);
    return {
      ruleId: item.rule.ruleId,
      label: item.rule.label,
      indicatorKey: item.rule.indicatorKey,
      indicatorName: nameOf.get(item.rule.indicatorKey) ?? item.rule.indicatorKey,
      status: item.status,
      severity: item.rule.severity,
      latest: item.latest ?? null,
      message: item.message,
      lag: stale && item.latest ? lagMonths(item.latest.date) : null,
    };
  });

  const triggered = items.filter((i) => i.status === "triggered");
  return {
    updatedAt,
    summary: {
      triggered: triggered.length,
      danger: triggered.filter((i) => i.severity === "danger").length,
      warning: triggered.filter((i) => i.severity === "warning").length,
      normal: items.filter((i) => i.status === "normal").length,
      noData: items.filter((i) => i.status === "no_data").length,
    },
    items,
  };
}

/** 首页摘要: 触发数 + 严重级别最高的前 3 条 (spec 002 US-3) */
export async function getAlertsDigest(): Promise<{
  summary: AlertSummary;
  topItems: AlertView[];
}> {
  const { summary, items } = await getAlertsReport();
  return { summary, topItems: items.filter((i) => i.status === "triggered").slice(0, 3) };
}
