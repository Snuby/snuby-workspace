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
import { setMonitorAlerting } from "@/lib/monitor-alert";
import {
  formatLastActiveAt,
  getMonitorSettings,
  isIdlePastThreshold,
  setMonitorSettings,
  subscribeMonitorSettings,
  type MonitorSettings,
} from "@/lib/monitor-settings";

const HOT_N = 5;
const POLL_MS = 2500;

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
  "shrink-0 rounded-[6px] px-2.5 py-1 text-[12px] text-ink-muted transition-colors duration-150 hover:bg-up-soft hover:text-up active:bg-up-soft disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted";

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
  const settings = useSyncExternalStore(subscribeMonitorSettings, getMonitorSettings, getMonitorSettings);

  useEffect(() => subscribeMonitorSources(() => setTick((n) => n + 1)), []);

  const refresh = useCallback(async () => {
    const tabs = listMonitorTabs();
    const ids = tabs.map((t) => t.webContentsId).filter((id): id is number => id != null);
    const api = typeof window !== "undefined" ? window.snubyDesktop : undefined;
    const { tabAlertMb, totalAlertPct } = getMonitorSettings();
    if (!api?.getPerfSnapshot) {
      setErr("仅桌面端可采样内存");
      setRows(tabs.map((t) => ({ ...t, rssMb: null })));
      setSnap(null);
      setMonitorAlerting(false);
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
      const tabHit = mapped.some((r) => r.rssMb != null && r.rssMb >= tabAlertMb);
      setMonitorAlerting(pct >= totalAlertPct || tabHit);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "采样失败");
      setRows(tabs.map((t) => ({ ...t, rssMb: null })));
      setMonitorAlerting(false);
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

  const processTotalMb = useMemo(() => {
    if (!snap) return 0;
    return snap.processes.reduce((s, p) => s + p.rssKb, 0) / 1024;
  }, [snap]);

  const totalMemMb = snap ? snap.totalMemBytes / (1024 * 1024) : 0;
  const pctOfMachine = totalMemMb > 0 ? (processTotalMb / totalMemMb) * 100 : 0;

  const maxTabMb = useMemo(() => {
    const known = rows.map((r) => r.rssMb ?? 0);
    return Math.max(settings.tabAlertMb, ...known, 1);
  }, [rows, settings.tabAlertMb]);

  const hot = useMemo(
    () =>
      rows
        .filter((r) => r.rssMb != null)
        .slice()
        .sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0))
        .slice(0, HOT_N),
    [rows],
  );

  const bySection = (section: MonitorSection) => rows.filter((r) => r.section === section);

  const handleClose = (row: Row) => {
    closeMonitorTab(row.section, row.moduleKey, row.groupId, row.tabId);
    window.setTimeout(() => void refresh(), 400);
  };

  const closeIdleIn = (section: MonitorSection) => {
    const { idleMinutes } = getMonitorSettings();
    for (const r of bySection(section)) {
      if (!isIdlePastThreshold(r.lastActiveAt, idleMinutes)) continue;
      closeMonitorTab(r.section, r.moduleKey, r.groupId, r.tabId);
    }
    window.setTimeout(() => void refresh(), 400);
  };

  const closeAllIdle = () => {
    const { idleMinutes } = getMonitorSettings();
    for (const r of rows) {
      if (!isIdlePastThreshold(r.lastActiveAt, idleMinutes)) continue;
      closeMonitorTab(r.section, r.moduleKey, r.groupId, r.tabId);
    }
    window.setTimeout(() => void refresh(), 400);
  };

  const idleAll = rows.filter((r) => isIdlePastThreshold(r.lastActiveAt, settings.idleMinutes)).length;
  const totalAlert = pctOfMachine >= settings.totalAlertPct;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<MonitorSettings>(settings);

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
          {/* 总览 */}
          <section
            className={[
              "rounded-[8px] border p-5",
              totalAlert ? "border-up/30 bg-up-soft/30" : "border-line bg-surface",
            ].join(" ")}
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[12px] text-ink-faint">App 合计内存</p>
                <p
                  className={[
                    "mt-1 text-[36px] font-bold leading-none tabular-nums tracking-tight",
                    totalAlert ? "text-up" : "text-ink",
                  ].join(" ")}
                  style={{
                    fontFamily: 'ui-monospace, "SF Mono", "Menlo", "Cascadia Mono", "Consolas", monospace',
                  }}
                >
                  {snap
                    ? `${formatCompact(processTotalMb)}/${formatCompact(totalMemMb)}（${pctOfMachine.toFixed(0)}%）`
                    : "—"}
                </p>
                <p className="mt-2 text-[12.5px] text-ink-muted">
                  {totalAlert ? (
                    <span className="font-medium text-up">已超过本机内存 {settings.totalAlertPct}%</span>
                  ) : (
                    <span>本机占比告警线 {settings.totalAlertPct}%</span>
                  )}
                  {` · 标签 ${rows.length}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-muted">
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
                  className="rounded-[6px] bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent-deep transition-opacity hover:opacity-80"
                >
                  刷新
                </button>
                <button
                  type="button"
                  disabled={idleAll === 0}
                  onClick={closeAllIdle}
                  className={CLOSE_BTN}
                  title={`关闭超过 ${settings.idleMinutes} 分钟未打开的标签`}
                >
                  关闭全部闲置
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
            <MemBar
              value={processTotalMb}
              max={Math.max(totalMemMb, processTotalMb, 1)}
              alert={totalAlert}
              className="mt-4 h-2.5"
            />
            {err ? <p className="mt-2 text-[12px] text-up">{err}</p> : null}
          </section>

          {/* 热点 */}
          {hot.length > 0 && hot.some((h) => (h.rssMb ?? 0) >= settings.tabAlertMb * 0.6) ? (
            <section className="rounded-[8px] border border-up/20 bg-up-soft/40 p-4">
              <h2 className="mb-2 text-[13px] font-semibold text-up">内存热点</h2>
              <div>
                {hot.map((r) => (
                  <div
                    key={`hot:${r.moduleKey}:${r.groupId}:${r.tabId}`}
                    className="flex items-center gap-3 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{r.title}</p>
                      <p className="truncate text-[11px] text-ink-faint">
                        {MONITOR_SECTION_LABEL[r.section]}
                        {r.section !== "browser" ? ` · ${r.moduleLabel}` : ""}
                        {` · ${r.groupLabel} · ${formatLastActiveAt(r.lastActiveAt)}`}
                      </p>
                    </div>
                    <span
                      className="shrink-0 text-[15px] font-bold tabular-nums text-up"
                      style={{
                        fontFamily:
                          'ui-monospace, "SF Mono", "Menlo", "Cascadia Mono", "Consolas", monospace',
                      }}
                    >
                      {formatMb(r.rssMb)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleClose(r)}
                      title={r.isHome ? "回收主页内存（下次进入该模块会重新加载）" : "关闭标签"}
                      className={CLOSE_BTN}
                    >
                      关闭
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <SectionBlock
            section="matrix"
            rows={bySection("matrix")}
            maxMb={maxTabMb}
            tabAlertMb={settings.tabAlertMb}
            idleMinutes={settings.idleMinutes}
            onClose={handleClose}
            onCloseIdle={() => closeIdleIn("matrix")}
          />
          <SectionBlock
            section="topic"
            rows={bySection("topic")}
            maxMb={maxTabMb}
            tabAlertMb={settings.tabAlertMb}
            idleMinutes={settings.idleMinutes}
            onClose={handleClose}
            onCloseIdle={() => closeIdleIn("topic")}
          />
          <SectionBlock
            section="browser"
            rows={bySection("browser")}
            maxMb={maxTabMb}
            tabAlertMb={settings.tabAlertMb}
            idleMinutes={settings.idleMinutes}
            onClose={handleClose}
            onCloseIdle={() => closeIdleIn("browser")}
          />

          <p className="pb-4 text-center text-[11.5px] text-ink-faint">
            内存按 webview 进程采样；未打开过的模块不会出现在列表中。关闭主页会回收内存，下次进入该模块会重新加载。
          </p>
        </div>
      </div>

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
              超过单标签/总内存阈值会告警；「关闭闲置」只关掉超过闲置时间未打开的标签。
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
