"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Topbar from "@/components/workbench/topbar";
import type { SnubyPerfSnapshot } from "@/types/snuby-desktop";
import {
  closeMonitorTab,
  listMonitorTabs,
  MONITOR_SECTION_LABEL,
  subscribeMonitorSources,
  type MonitorSection,
  type MonitorTabInfo,
} from "@/lib/monitor-registry";
import { MONITOR_UI_MOCK, setMonitorAlerting } from "@/lib/monitor-alert";
import {
  formatLastActiveAt,
  getMonitorSettings,
  isIdlePastThreshold,
  setMonitorSettings,
  subscribeMonitorSettings,
  type MonitorSettings,
} from "@/lib/monitor-settings";

const POLL_MS = 2500;

/** 与 MONITOR_UI_MOCK 同步: 注入超阈值假数据 */
const USE_MONITOR_MOCK = MONITOR_UI_MOCK;

function buildMockRows(now = Date.now()): Row[] {
  const idleMs = 45 * 60_000; // 超过默认 30 分钟闲置
  return [
    {
      section: "browser",
      moduleKey: "browser",
      moduleLabel: "Web 访问",
      groupId: "default",
      groupLabel: "主页",
      tabId: "mock-browser-heavy",
      title: "【演示】超大标签 · 新闻站",
      url: "https://example.com/heavy",
      isHome: false,
      isActive: false,
      lastActiveAt: now - idleMs,
      webContentsId: null,
      rssMb: 780,
    },
    {
      section: "matrix",
      moduleKey: "weixin",
      moduleLabel: "微信公众号",
      groupId: "mock-acc-1",
      groupLabel: "演示账号 A",
      tabId: "mock-wx-home",
      title: "【演示】公众号后台",
      url: "https://mp.weixin.qq.com/",
      isHome: true,
      isActive: false,
      lastActiveAt: now - idleMs,
      webContentsId: null,
      rssMb: 620,
    },
    {
      section: "topic",
      moduleKey: "it-news",
      moduleLabel: "IT 资讯",
      groupId: "mock-verge",
      groupLabel: "The Verge",
      tabId: "mock-topic-heavy",
      title: "【演示】长文页",
      url: "https://www.theverge.com/mock",
      isHome: false,
      isActive: true,
      lastActiveAt: now - 60_000,
      webContentsId: null,
      rssMb: 540,
    },
    {
      section: "topic",
      moduleKey: "it-news",
      moduleLabel: "IT 资讯",
      groupId: "mock-infoq",
      groupLabel: "InfoQ 中文",
      tabId: "mock-topic-idle",
      title: "【演示】闲置标签",
      url: "https://www.infoq.cn/mock",
      isHome: false,
      isActive: false,
      lastActiveAt: now - idleMs,
      webContentsId: null,
      rssMb: 180,
    },
  ];
}


type Row = MonitorTabInfo & { rssMb: number | null };

function formatMb(mb: number | null | undefined): string {
  if (mb == null || !Number.isFinite(mb)) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(0)} MB`;
}

/** 紧凑容量: 1.2G / 512M */
function formatCompact(mb: number): string {
  if (!Number.isFinite(mb) || mb < 0) return "—";
  if (mb >= 1024) {
    const g = mb / 1024;
    return `${g >= 10 ? g.toFixed(0) : g.toFixed(1)}G`;
  }
  return `${Math.round(mb)}M`;
}

function kbToMb(kb: number | null | undefined): number | null {
  if (kb == null || !Number.isFinite(kb)) return null;
  return kb / 1024;
}

const CLOSE_BTN =
  "inline-flex shrink-0 items-center justify-center rounded-[6px] px-2.5 py-1 text-[12px] text-ink-muted transition-colors duration-150 hover:bg-up-soft hover:text-up active:bg-up-soft disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted";

/** 总览区批量关闭：实心按钮，强调可操作 */
const BULK_CLOSE_BTN =
  "inline-flex shrink-0 items-center justify-center rounded-[6px] bg-up px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-ink-faint disabled:opacity-40";

type ConfirmCloseKind = "idle" | "high";

type ConfirmCloseState = {
  kind: ConfirmCloseKind;
  targets: Row[];
};

function ConfirmCloseDialog({
  state,
  idleMinutes,
  tabAlertMb,
  onCancel,
  onConfirm,
}: {
  state: ConfirmCloseState;
  idleMinutes: number;
  tabAlertMb: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isHigh = state.kind === "high";
  const title = isHigh ? "关闭高内存标签" : "关闭闲置标签";
  const hint = isHigh
    ? `将关闭以下超过 ${tabAlertMb} MB 的标签。请先保存未完成的工作，关闭后相关页面会被卸载。`
    : `将关闭以下超过 ${idleMinutes} 分钟未打开的闲置标签：`;

  const grouped = (() => {
    const order: MonitorSection[] = ["matrix", "topic", "browser"];
    const map = new Map<MonitorSection, Row[]>();
    for (const r of state.targets) {
      const list = map.get(r.section) ?? [];
      list.push(r);
      map.set(r.section, list);
    }
    return order
      .filter((s) => (map.get(s)?.length ?? 0) > 0)
      .map((s) => ({ section: s, rows: map.get(s)! }));
  })();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[560px] max-w-[94vw] flex-col rounded-xl border border-line bg-white p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14.5px] font-bold text-ink">{title}</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          >
            ×
          </button>
        </div>
        <p className={["text-[12.5px] leading-relaxed", isHigh ? "text-up" : "text-ink-muted"].join(" ")}>
          {hint}
        </p>
        <div className="mt-3 max-h-[42vh] space-y-3 overflow-auto rounded-[8px] border border-line bg-page px-3 py-2.5">
          {grouped.map(({ section, rows }) => (
            <div key={section}>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                {MONITOR_SECTION_LABEL[section]}
                <span className="ml-1 font-normal normal-case tracking-normal">({rows.length})</span>
              </p>
              <ul className="space-y-1">
                {rows.map((r) => (
                  <li
                    key={`${r.section}:${r.moduleKey}:${r.groupId}:${r.tabId}`}
                    className="flex items-start justify-between gap-3 rounded-[6px] bg-white px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{r.title}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-ink-faint">
                        {r.moduleLabel}
                        {r.groupLabel && r.groupLabel !== r.moduleLabel ? ` · ${r.groupLabel}` : ""}
                      </p>
                    </div>
                    <span
                      className={[
                        "shrink-0 pt-0.5 text-[12.5px] font-semibold tabular-nums",
                        isHigh || (r.rssMb != null && r.rssMb >= tabAlertMb) ? "text-up" : "text-ink-muted",
                      ].join(" ")}
                      style={{
                        fontFamily: 'ui-monospace, "SF Mono", "Menlo", "Cascadia Mono", "Consolas", monospace',
                      }}
                    >
                      {formatMb(r.rssMb)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-ink-faint">共 {state.targets.length} 个标签</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-muted hover:bg-hover"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-up px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            确认关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function MemBar({
  value,
  max,
  alert,
  className,
}: {
  value: number;
  max: number;
  alert?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={["h-1.5 overflow-hidden rounded-full bg-surface-2", className].filter(Boolean).join(" ")}>
      <div
        className={["h-full rounded-full transition-[width] duration-300", alert ? "bg-up" : "bg-accent"].join(" ")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[11.5px] text-ink-faint">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full min-w-0 rounded-[6px] border border-line bg-page px-2.5 py-1.5 text-[13px] tabular-nums text-ink outline-none focus:border-accent"
        />
        <span className="shrink-0 text-[12px] text-ink-faint">{unit}</span>
      </div>
    </label>
  );
}

function TabRow({
  row,
  maxMb,
  tabAlertMb,
  idleMinutes,
  onClose,
}: {
  row: Row;
  maxMb: number;
  tabAlertMb: number;
  idleMinutes: number;
  onClose: () => void;
}) {
  const alert = row.rssMb != null && row.rssMb >= tabAlertMb;
  const idle = isIdlePastThreshold(row.lastActiveAt, idleMinutes);
  return (
    <div className="flex items-center gap-3 border-b border-line/60 px-1 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className={["truncate text-[13px]", alert ? "font-medium text-up" : "text-ink"].join(" ")}>
            {row.title || "未命名"}
          </p>
          {row.isHome ? (
            <span className="shrink-0 rounded bg-surface-2 px-1 py-px text-[10px] text-ink-faint">主页</span>
          ) : null}
          {row.isActive ? (
            <span className="shrink-0 rounded bg-accent-soft px-1 py-px text-[10px] text-accent-deep">当前</span>
          ) : null}
          {idle ? (
            <span className="shrink-0 rounded bg-up-soft px-1 py-px text-[10px] text-up">闲置</span>
          ) : null}
        </div>
        <p className="truncate text-[11.5px] text-ink-faint" title={row.url}>
          {row.groupLabel}
          {row.url ? ` · ${row.url}` : ""}
        </p>
      </div>
      <div className="w-[72px] shrink-0 text-right">
        <p className={["text-[11.5px] tabular-nums", idle ? "text-up" : "text-ink-faint"].join(" ")}>
          {formatLastActiveAt(row.lastActiveAt)}
        </p>
      </div>
      <div className="w-[88px] shrink-0 text-right">
        <p
          className={[
            "text-[14px] font-bold tabular-nums leading-none",
            alert ? "text-up" : "text-ink",
          ].join(" ")}
          style={{
            fontFamily: 'ui-monospace, "SF Mono", "Menlo", "Cascadia Mono", "Consolas", monospace',
          }}
        >
          {formatMb(row.rssMb)}
        </p>
        {row.rssMb != null ? (
          <MemBar value={row.rssMb} max={maxMb} alert={alert} className="mt-1.5" />
        ) : (
          <div className="mt-1.5 h-1.5" />
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        title={row.isHome ? "回收主页内存（下次进入该模块会重新加载）" : "关闭标签"}
        className={CLOSE_BTN}
      >
        关闭
      </button>
    </div>
  );
}

function SectionBlock({
  section,
  rows,
  maxMb,
  tabAlertMb,
  idleMinutes,
  onClose,
  onCloseIdle,
}: {
  section: MonitorSection;
  rows: Row[];
  maxMb: number;
  tabAlertMb: number;
  idleMinutes: number;
  onClose: (row: Row) => void;
  onCloseIdle: () => void;
}) {
  const totalMb = rows.reduce((s, r) => s + (r.rssMb ?? 0), 0);
  const idleClosable = rows.filter((r) => isIdlePastThreshold(r.lastActiveAt, idleMinutes)).length;

  const groups = useMemo(() => {
    const map = new Map<string, { moduleLabel: string; groupLabel: string; rows: Row[] }>();
    for (const r of rows) {
      const key = `${r.moduleKey}::${r.groupId}`;
      const g = map.get(key);
      if (g) g.rows.push(r);
      else map.set(key, { moduleLabel: r.moduleLabel, groupLabel: r.groupLabel, rows: [r] });
    }
    return [...map.entries()];
  }, [rows]);

  const sortRows = (list: Row[]) =>
    list.slice().sort((a, b) => {
      const idleDiff =
        Number(isIdlePastThreshold(b.lastActiveAt, idleMinutes)) -
        Number(isIdlePastThreshold(a.lastActiveAt, idleMinutes));
      if (idleDiff !== 0) return idleDiff;
      return (b.rssMb ?? -1) - (a.rssMb ?? -1);
    });

  return (
    <section className="rounded-[8px] border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-ink">{MONITOR_SECTION_LABEL[section]}</h2>
          <p className="mt-0.5 text-[12px] text-ink-faint">
            {rows.length} 个标签 · 合计 {formatMb(totalMb || null)}
            {idleClosable > 0 ? ` · 闲置 ${idleClosable}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden w-28 sm:block">
            <MemBar value={totalMb} max={Math.max(maxMb, totalMb, 1)} alert={totalMb >= tabAlertMb * 3} />
          </div>
          <button
            type="button"
            disabled={idleClosable === 0}
            onClick={onCloseIdle}
            className={CLOSE_BTN}
            title={`关闭超过 ${idleMinutes} 分钟未打开的标签`}
          >
            关闭闲置 ({idleClosable})
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-ink-faint">尚未打开过，无常驻标签</p>
      ) : section === "browser" ? (
        <div>
          {sortRows(rows).map((r) => (
            <TabRow
              key={`${r.moduleKey}:${r.groupId}:${r.tabId}`}
              row={r}
              maxMb={maxMb}
              tabAlertMb={tabAlertMb}
              idleMinutes={idleMinutes}
              onClose={() => onClose(r)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([key, g]) => (
            <div key={key}>
              <p className="mb-1 text-[12px] font-medium text-ink-muted">
                {g.moduleLabel}
                <span className="font-normal text-ink-faint"> · {g.groupLabel}</span>
              </p>
              {sortRows(g.rows).map((r) => (
                <TabRow
                  key={`${r.moduleKey}:${r.groupId}:${r.tabId}`}
                  row={r}
                  maxMb={maxMb}
                  tabAlertMb={tabAlertMb}
                  idleMinutes={idleMinutes}
                  onClose={() => onClose(r)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function MonitorPage() {
  const [tick, setTick] = useState(0);
  const [auto, setAuto] = useState(true);
  const [snap, setSnap] = useState<SnubyPerfSnapshot | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");
  const [mockGone, setMockGone] = useState<Set<string>>(() => new Set());
  const settings = useSyncExternalStore(subscribeMonitorSettings, getMonitorSettings, getMonitorSettings);

  useEffect(() => subscribeMonitorSources(() => setTick((n) => n + 1)), []);

  const refresh = useCallback(async () => {
    const tabs = listMonitorTabs();
    const ids = tabs.map((t) => t.webContentsId).filter((id): id is number => id != null);
    const api = typeof window !== "undefined" ? window.snubyDesktop : undefined;
    const { totalAlertPct } = getMonitorSettings();
    if (!api?.getPerfSnapshot) {
      setErr("仅桌面端可采样内存");
      setRows(tabs.map((t) => ({ ...t, rssMb: null })));
      setSnap(null);
      setMonitorAlerting(USE_MONITOR_MOCK);
      return;
    }
    try {
      const next = await api.getPerfSnapshot(ids);
      setSnap(next);
      setErr("");
      const mapped = tabs.map((t) => {
        const info = t.webContentsId != null ? next.tabs[String(t.webContentsId)] : undefined;
        return { ...t, rssMb: kbToMb(info?.rssKb ?? null) };
      });
      setRows(mapped);
      const processTotalMb = next.processes.reduce((s, p) => s + p.rssKb, 0) / 1024;
      const totalMemMb = next.totalMemBytes / (1024 * 1024);
      const pct = totalMemMb > 0 ? (processTotalMb / totalMemMb) * 100 : 0;
      // 侧栏仅总体占比超阈值告警；单标签高内存只在本页高亮，不驱动侧栏
      setMonitorAlerting(USE_MONITOR_MOCK || pct >= totalAlertPct);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "采样失败");
      setRows(tabs.map((t) => ({ ...t, rssMb: null })));
      setMonitorAlerting(USE_MONITOR_MOCK);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, tick, settings.tabAlertMb, settings.totalAlertPct]);

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [auto, refresh]);

  const displayRows = useMemo(() => {
    if (!USE_MONITOR_MOCK) return rows;
    const mocks = buildMockRows().filter((r) => !mockGone.has(r.tabId));
    return [...mocks, ...rows];
  }, [rows, mockGone]);

  const processTotalMb = useMemo(() => {
    if (USE_MONITOR_MOCK) {
      const mockSum = displayRows
        .filter((r) => r.tabId.startsWith("mock-"))
        .reduce((s, r) => s + (r.rssMb ?? 0), 0);
      const real = snap ? snap.processes.reduce((s, p) => s + p.rssKb, 0) / 1024 : 0;
      return real + mockSum;
    }
    if (!snap) return 0;
    return snap.processes.reduce((s, p) => s + p.rssKb, 0) / 1024;
  }, [snap, displayRows]);

  const totalMemMb = useMemo(() => {
    if (USE_MONITOR_MOCK) {
      // 故意让占比超过默认 50% 告警线
      return Math.max(processTotalMb / 0.62, processTotalMb + 1);
    }
    return snap ? snap.totalMemBytes / (1024 * 1024) : 0;
  }, [snap, processTotalMb]);

  const pctOfMachine = totalMemMb > 0 ? (processTotalMb / totalMemMb) * 100 : 0;

  const maxTabMb = useMemo(() => {
    const known = displayRows.map((r) => r.rssMb ?? 0);
    return Math.max(settings.tabAlertMb, ...known, 1);
  }, [displayRows, settings.tabAlertMb]);

  const bySection = (section: MonitorSection) => displayRows.filter((r) => r.section === section);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<MonitorSettings>(settings);
  const [confirmClose, setConfirmClose] = useState<ConfirmCloseState | null>(null);

  const handleClose = (row: Row) => {
    if (row.tabId.startsWith("mock-")) {
      setMockGone((prev) => new Set(prev).add(row.tabId));
      return;
    }
    closeMonitorTab(row.section, row.moduleKey, row.groupId, row.tabId);
    window.setTimeout(() => void refresh(), 400);
  };

  const applyCloseTargets = (targets: Row[]) => {
    const mockIds: string[] = [];
    for (const r of targets) {
      if (r.tabId.startsWith("mock-")) {
        mockIds.push(r.tabId);
        continue;
      }
      closeMonitorTab(r.section, r.moduleKey, r.groupId, r.tabId);
    }
    if (mockIds.length > 0) {
      setMockGone((prev) => {
        const next = new Set(prev);
        for (const id of mockIds) next.add(id);
        return next;
      });
    }
    setConfirmClose(null);
    window.setTimeout(() => void refresh(), 400);
  };

  const idleTargets = (section?: MonitorSection) => {
    const list = section ? bySection(section) : displayRows;
    return list.filter((r) => isIdlePastThreshold(r.lastActiveAt, settings.idleMinutes));
  };

  const highMemTargets = () =>
    displayRows.filter((r) => r.rssMb != null && r.rssMb >= settings.tabAlertMb);

  const requestCloseIdle = (section?: MonitorSection) => {
    const targets = idleTargets(section);
    if (targets.length === 0) return;
    setConfirmClose({ kind: "idle", targets });
  };

  const requestCloseHigh = () => {
    const targets = highMemTargets();
    if (targets.length === 0) return;
    setConfirmClose({ kind: "high", targets });
  };

  const idleAll = idleTargets().length;
  const highAll = highMemTargets().length;
  const totalAlert = pctOfMachine >= settings.totalAlertPct;

  useEffect(() => {
    if (settingsOpen) setDraft(settings);
  }, [settingsOpen, settings]);

  const saveSettings = () => {
    setMonitorSettings(draft);
    setSettingsOpen(false);
  };

  return (
    <>
      <Topbar title="监控" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
          {USE_MONITOR_MOCK ? (
            <div className="rounded-[8px] border border-accent/25 bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-accent-deep">
              当前为演示数据：含超单标签阈值、超总内存占比、以及可「关闭闲置」的过期标签。看完把{" "}
              <code className="rounded bg-white/70 px-1">MONITOR_UI_MOCK</code>（
              <code className="rounded bg-white/70 px-1">monitor-alert.ts</code>）改为{" "}
              <code className="rounded bg-white/70 px-1">false</code>。
            </div>
          ) : null}

          {/* 总览 */}
          <section
            className={[
              "rounded-[8px] border px-4 py-3.5",
              totalAlert ? "border-up/30 bg-up-soft/30" : "border-line bg-surface",
            ].join(" ")}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-5">
              {/* 左：内存主信息；刷新控件回到顶部 */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="flex h-7 items-center text-[12px] leading-none text-ink-faint">
                    App 合计内存
                  </p>
                  <div className="flex h-7 items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] leading-none text-ink-muted">
                      <input
                        type="checkbox"
                        checked={auto}
                        onChange={(e) => setAuto(e.target.checked)}
                        className="accent-accent"
                      />
                      自动刷新
                    </label>
                    <button
                      type="button"
                      onClick={() => void refresh()}
                      className="rounded-[6px] bg-accent-soft px-2.5 py-1 text-[12px] font-medium leading-none text-accent-deep transition-opacity hover:opacity-80"
                    >
                      刷新
                    </button>
                    <button
                      type="button"
                      aria-label="阈值设置"
                      title="阈值设置"
                      onClick={() => setSettingsOpen(true)}
                      className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
                    >
                      <IconGear className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p
                  className={[
                    "mt-1.5 text-[28px] font-bold leading-none tabular-nums tracking-tight",
                    totalAlert ? "text-up" : "text-ink",
                  ].join(" ")}
                  style={{
                    fontFamily: 'ui-monospace, "SF Mono", "Menlo", "Cascadia Mono", "Consolas", monospace',
                  }}
                >
                  {snap || USE_MONITOR_MOCK
                    ? `${formatCompact(processTotalMb)}/${formatCompact(totalMemMb)}（${pctOfMachine.toFixed(0)}%）`
                    : "—"}
                </p>
                <p className="mt-1.5 text-[12px] leading-none text-ink-muted">
                  {totalAlert ? (
                    <span className="font-medium text-up">已超过本机内存 {settings.totalAlertPct}%</span>
                  ) : (
                    <span>本机占比告警线 {settings.totalAlertPct}%</span>
                  )}
                </p>
                <MemBar
                  value={processTotalMb}
                  max={Math.max(totalMemMb, processTotalMb, 1)}
                  alert={totalAlert}
                  className="mt-2.5 h-2"
                />
              </div>

              {/* 右：顶对齐指标 + 底对齐操作，两侧左对齐 */}
              <div className="flex shrink-0 flex-col items-start justify-between gap-3 border-t border-line/70 pt-3 sm:min-w-[220px] sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                <div className="flex items-start gap-5">
                  <div>
                    <p className="flex h-7 items-center text-[12px] leading-none text-ink-faint">标签</p>
                    <p className="text-[16px] font-semibold tabular-nums leading-none text-ink">
                      {displayRows.length}
                    </p>
                  </div>
                  <div>
                    <p className="flex h-7 items-center text-[12px] leading-none text-ink-faint">闲置</p>
                    <p
                      className={[
                        "text-[16px] font-semibold tabular-nums leading-none",
                        idleAll > 0 ? "text-ink" : "text-ink-faint",
                      ].join(" ")}
                    >
                      {idleAll}
                    </p>
                  </div>
                  <div>
                    <p className="flex h-7 items-center text-[12px] leading-none text-ink-faint">高内存</p>
                    <p
                      className={[
                        "text-[16px] font-semibold tabular-nums leading-none",
                        highAll > 0 ? "text-up" : "text-ink-faint",
                      ].join(" ")}
                    >
                      {highAll}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={idleAll === 0}
                    onClick={() => requestCloseIdle()}
                    className={BULK_CLOSE_BTN}
                    title={`关闭超过 ${settings.idleMinutes} 分钟未打开的标签`}
                  >
                    关闭全部闲置
                  </button>
                  <button
                    type="button"
                    disabled={highAll === 0}
                    onClick={requestCloseHigh}
                    className={BULK_CLOSE_BTN}
                    title={`关闭超过 ${settings.tabAlertMb} MB 的高内存标签`}
                  >
                    关闭高内存
                  </button>
                </div>
              </div>
            </div>
            {err ? <p className="mt-2 text-[12px] text-up">{err}</p> : null}
          </section>

          <SectionBlock
            section="matrix"
            rows={bySection("matrix")}
            maxMb={maxTabMb}
            tabAlertMb={settings.tabAlertMb}
            idleMinutes={settings.idleMinutes}
            onClose={handleClose}
            onCloseIdle={() => requestCloseIdle("matrix")}
          />
          <SectionBlock
            section="topic"
            rows={bySection("topic")}
            maxMb={maxTabMb}
            tabAlertMb={settings.tabAlertMb}
            idleMinutes={settings.idleMinutes}
            onClose={handleClose}
            onCloseIdle={() => requestCloseIdle("topic")}
          />
          <SectionBlock
            section="browser"
            rows={bySection("browser")}
            maxMb={maxTabMb}
            tabAlertMb={settings.tabAlertMb}
            idleMinutes={settings.idleMinutes}
            onClose={handleClose}
            onCloseIdle={() => requestCloseIdle("browser")}
          />

          <p className="pb-4 text-center text-[11.5px] text-ink-faint">
            内存按 webview 进程采样；未打开过的模块不会出现在列表中。关闭主页会回收内存，下次进入该模块会重新加载。
          </p>
        </div>
      </div>

      {confirmClose ? (
        <ConfirmCloseDialog
          state={confirmClose}
          idleMinutes={settings.idleMinutes}
          tabAlertMb={settings.tabAlertMb}
          onCancel={() => setConfirmClose(null)}
          onConfirm={() => applyCloseTargets(confirmClose.targets)}
        />
      ) : null}

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="阈值设置"
            onClick={(e) => e.stopPropagation()}
            className="w-[400px] max-w-[90vw] rounded-xl border border-line bg-white p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[14.5px] font-bold text-ink">阈值设置</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setSettingsOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              <Field
                label="单标签阈值"
                unit="MB"
                value={draft.tabAlertMb}
                min={50}
                max={4096}
                onChange={(n) => setDraft((d) => ({ ...d, tabAlertMb: n }))}
              />
              <Field
                label="总内存阈值"
                unit="%"
                value={draft.totalAlertPct}
                min={5}
                max={95}
                onChange={(n) => setDraft((d) => ({ ...d, totalAlertPct: n }))}
              />
              <Field
                label="闲置时间阈值"
                unit="分钟"
                value={draft.idleMinutes}
                min={1}
                max={24 * 60}
                onChange={(n) => setDraft((d) => ({ ...d, idleMinutes: n }))}
              />
            </div>
            <p className="mt-3 text-[11.5px] text-ink-faint">
              侧栏告警仅看总内存占比；单标签超标只在本页标红。「关闭闲置」只关掉超过闲置时间未打开的标签。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-muted hover:bg-hover"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveSettings}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function IconGear({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  );
}
