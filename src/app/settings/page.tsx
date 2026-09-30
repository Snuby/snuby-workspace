"use client";

// 设置：本地 Agent 不活跃超时 + 全局标签/历史上限 + 关于（单页）

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Topbar from "@/components/workbench/topbar";

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

type SaveState = "idle" | "saving" | "saved" | "error";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line/70 py-5 last:border-b-0">
      <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
      {hint ? <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">{hint}</p> : null}
      <div className="mt-3 space-y-2.5">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <span className="shrink-0 text-[12.5px] text-ink-muted">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

function NumberField({
  value,
  min,
  max,
  suffix,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const next = clamp(Math.round(n), min, max);
    setText(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <>
      <input
        type="number"
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        className="h-7 w-[72px] rounded-md border border-line bg-white px-2 text-center text-[12.5px] tabular-nums outline-none focus:border-accent"
      />
      {suffix ? <span className="text-[11px] text-ink-faint">{suffix}</span> : null}
    </>
  );
}

export default function SettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [inactivityMin, setInactivityMin] = useState(10);
  const [maxTabs, setMaxTabs] = useState(10);
  const [maxHistory, setMaxHistory] = useState(100);
  const [version, setVersion] = useState("0.1.0");
  const [userDataPath, setUserDataPath] = useState("");
  const [userDataDisplay, setUserDataDisplay] = useState("~/snuby-workspace-data");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveTip, setSaveTip] = useState("");
  const [openingFolder, setOpeningFolder] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptErr, setPromptErr] = useState("");
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((state: SaveState, tip: string) => {
    setSaveState(state);
    setSaveTip(tip);
    if (tipTimer.current) clearTimeout(tipTimer.current);
    if (state === "saved" || state === "error") {
      tipTimer.current = setTimeout(() => {
        setSaveState("idle");
        setSaveTip("");
      }, 1800);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [agentRes, limitsRes, infoRes] = await Promise.all([
          fetch("/api/agent/preference", { cache: "no-store" }),
          fetch("/api/site-tabs?limits=1", { cache: "no-store" }),
          fetch("/api/app-info", { cache: "no-store" }),
        ]);
        if (agentRes.ok) {
          const j = (await agentRes.json()) as { inactivityTimeoutMs?: number };
          const ms = j.inactivityTimeoutMs ?? 600_000;
          setInactivityMin(ms <= 0 ? 0 : Math.round(ms / 60_000));
        }
        if (limitsRes.ok) {
          const j = (await limitsRes.json()) as { maxTabs?: number; maxHistory?: number };
          if (typeof j.maxTabs === "number") setMaxTabs(j.maxTabs);
          if (typeof j.maxHistory === "number") setMaxHistory(j.maxHistory);
        }
        if (infoRes.ok) {
          const j = (await infoRes.json()) as {
            version?: string;
            userDataPath?: string;
            userDataPathDisplay?: string;
          };
          if (j.version) setVersion(j.version);
          if (j.userDataPath) setUserDataPath(j.userDataPath);
          if (j.userDataPathDisplay) setUserDataDisplay(j.userDataPathDisplay);
        }
      } catch {
        // 用默认值
      }
      setLoaded(true);
    })();
    return () => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
    };
  }, []);

  const saveAgentTimeout = async (mins: number) => {
    const next = mins <= 0 ? 0 : clamp(Math.round(mins), 1, 60);
    setInactivityMin(next);
    flash("saving", "保存中…");
    const ms = next <= 0 ? 0 : next * 60_000;
    try {
      const r = await fetch("/api/agent/preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inactivityTimeoutMs: ms }),
      });
      if (!r.ok) throw new Error("save failed");
      flash("saved", "已保存");
    } catch {
      flash("error", "保存失败");
    }
  };

  const saveTabLimits = async (patch: { maxTabs?: number; maxHistory?: number }) => {
    const nextTabs = patch.maxTabs ?? maxTabs;
    const nextHistory = patch.maxHistory ?? maxHistory;
    if (patch.maxTabs !== undefined) setMaxTabs(nextTabs);
    if (patch.maxHistory !== undefined) setMaxHistory(nextHistory);
    flash("saving", "保存中…");
    try {
      const r = await fetch("/api/site-tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "global-limits",
          maxTabs: nextTabs,
          maxHistory: nextHistory,
        }),
      });
      if (!r.ok) throw new Error("save failed");
      const j = (await r.json()) as { maxTabs?: number; maxHistory?: number };
      if (typeof j.maxTabs === "number") setMaxTabs(j.maxTabs);
      if (typeof j.maxHistory === "number") setMaxHistory(j.maxHistory);
      flash("saved", "已保存");
    } catch {
      flash("error", "保存失败");
    }
  };

  const openPromptEditor = async () => {
    setPromptErr("");
    setPromptBusy(true);
    setPromptOpen(true);
    try {
      const r = await fetch("/api/agent/system-prompt", { cache: "no-store" });
      const j = (await r.json()) as { prompt?: string; error?: string };
      if (!r.ok) throw new Error(j.error || "加载失败");
      setPromptDraft(j.prompt ?? "");
    } catch (e) {
      setPromptErr(e instanceof Error ? e.message : "加载失败");
      setPromptDraft("");
    } finally {
      setPromptBusy(false);
    }
  };

  const savePrompt = async () => {
    const text = promptDraft.trim();
    if (!text) {
      setPromptErr("约定内容不能为空");
      return;
    }
    setPromptBusy(true);
    setPromptErr("");
    flash("saving", "保存中…");
    try {
      const r = await fetch("/api/agent/system-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || "保存失败");
      setPromptOpen(false);
      flash("saved", "已保存，下次注入将使用新约定");
    } catch (e) {
      setPromptErr(e instanceof Error ? e.message : "保存失败");
      flash("error", "保存失败");
    } finally {
      setPromptBusy(false);
    }
  };

  const openUserData = async () => {
    if (!userDataPath || openingFolder) return;
    setOpeningFolder(true);
    try {
      const r = await fetch("/api/agent/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: userDataPath }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        flash("error", j.error || "打开失败");
      }
    } catch {
      flash("error", "打开失败");
    } finally {
      setOpeningFolder(false);
    }
  };

  return (
    <>
      <Topbar title="设置" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h1 className="text-[16px] font-semibold text-ink">设置</h1>
            {saveTip ? (
              <span
                className={[
                  "text-[11.5px]",
                  saveState === "error" ? "text-up" : "text-ink-faint",
                ].join(" ")}
              >
                {saveTip}
              </span>
            ) : null}
          </div>

          {!loaded ? (
            <div className="py-10 text-center text-[13px] text-ink-faint">加载中…</div>
          ) : (
            <div>
              <Section
                title="本地 Agent"
                hint="任务总时长不限制；仅在距上一次网关响应超过下方时长时视为不活跃。任意响应都会重置计时。"
              >
                <SettingRow label="不活跃超时">
                  <NumberField
                    value={inactivityMin}
                    min={0}
                    max={60}
                    suffix="分钟（0 = 禁用）"
                    onCommit={(n) => void saveAgentTimeout(n)}
                  />
                </SettingRow>
                <SettingRow label="工作约定">
                  <button
                    type="button"
                    onClick={() => void openPromptEditor()}
                    className="shrink-0 rounded-md border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
                  >
                    编辑系统提示词
                  </button>
                </SettingRow>
              </Section>

              <Section
                title="标签与浏览"
                hint="全局一套上限，作用于全部主题与 Web 访问模块。超出后自动裁掉最旧项。"
              >
                <SettingRow label="标签上限">
                  <NumberField
                    value={maxTabs}
                    min={2}
                    max={50}
                    suffix="2–50"
                    onCommit={(n) => void saveTabLimits({ maxTabs: n })}
                  />
                </SettingRow>
                <SettingRow label="历史上限">
                  <NumberField
                    value={maxHistory}
                    min={10}
                    max={2000}
                    suffix="10–2000"
                    onCommit={(n) => void saveTabLimits({ maxHistory: n })}
                  />
                </SettingRow>
              </Section>

              <Section title="关于">
                <SettingRow label="版本">
                  <span className="text-[12.5px] tabular-nums text-ink-faint">v{version}</span>
                </SettingRow>
                <SettingRow label="用户数据目录">
                  <span
                    className="max-w-[280px] truncate text-right text-[12.5px] text-ink-faint"
                    title={userDataPath || userDataDisplay}
                  >
                    {userDataDisplay}
                  </span>
                  <button
                    type="button"
                    disabled={!userDataPath || openingFolder}
                    onClick={() => void openUserData()}
                    className="shrink-0 rounded-md border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
                  >
                    {openingFolder ? "打开中…" : "在访达中打开"}
                  </button>
                </SettingRow>
              </Section>
            </div>
          )}
        </div>
      </div>

      {promptOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
          onClick={() => {
            if (!promptBusy) setPromptOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="编辑系统提示词"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[min(720px,86vh)] w-[min(640px,92vw)] flex-col rounded-xl border border-line bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div>
                <h3 className="text-[14px] font-semibold text-ink">工作约定 · 系统提示词</h3>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">
                  全局生效；保存后下次会话注入将自动使用新内容
                </p>
              </div>
              <button
                type="button"
                disabled={promptBusy}
                onClick={() => setPromptOpen(false)}
                className="rounded-md px-2 py-1 text-[12px] text-ink-faint hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 px-5 py-4">
              <textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                disabled={promptBusy}
                spellCheck={false}
                className="h-[min(420px,52vh)] w-full resize-none rounded-lg border border-line bg-page px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink outline-none focus:border-accent disabled:opacity-60"
                placeholder="加载中…"
              />
              {promptErr ? <p className="mt-2 text-[12px] text-up">{promptErr}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <button
                type="button"
                disabled={promptBusy}
                onClick={() => setPromptOpen(false)}
                className="rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-hover disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                disabled={promptBusy}
                onClick={() => void savePrompt()}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {promptBusy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
