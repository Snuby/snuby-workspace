"use client";

// Spec: 017-site-tabs — 设置页: 站点标签页按模块独立配置 (maxTabs 2-50 / maxHistory 10-2000)
// + 本地 Agent 不活跃超时 (agent-preference.json)

import { useEffect, useState } from "react";
import Topbar from "@/components/workbench/topbar";

const MODULES: Array<{ key: string; label: string }> = [
  { key: "it-news", label: "IT 资讯" },
  { key: "leaderboard", label: "AI 模型榜单" },
  { key: "creators", label: "自媒体" },
  { key: "browser", label: "Web 访问" },
];

type ModuleSettings = { maxTabs: number; maxHistory: number };

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, ModuleSettings>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savedTip, setSavedTip] = useState(false);
  /** 本地 Agent: 不活跃超时 (分钟); 0 = 禁用 */
  const [inactivityMin, setInactivityMin] = useState(10);
  const [agentDirty, setAgentDirty] = useState(false);

  useEffect(() => {
    (async () => {
      const next: Record<string, ModuleSettings> = {};
      for (const m of MODULES) {
        try {
          const res = await fetch(`/api/site-tabs?module=${encodeURIComponent(m.key)}`);
          if (!res.ok) continue;
          const data = await res.json();
          next[m.key] = data.settings ?? { maxTabs: 10, maxHistory: 100 };
        } catch {
          next[m.key] = { maxTabs: 10, maxHistory: 100 };
        }
      }
      setValues(next);
      try {
        const r = await fetch("/api/agent/preference", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { inactivityTimeoutMs?: number };
          const ms = j.inactivityTimeoutMs ?? 600_000;
          setInactivityMin(ms <= 0 ? 0 : Math.round(ms / 60_000));
        }
      } catch {
        // 用默认 10
      }
      setLoaded(true);
    })();
  }, []);

  function update(key: string, patch: Partial<ModuleSettings>) {
    setValues((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { maxTabs: 10, maxHistory: 100 }), ...patch } }));
    setDirty(true);
    setSavedTip(false);
  }

  async function saveAll() {
    setSaving(true);
    for (const m of MODULES) {
      const v = values[m.key] ?? { maxTabs: 10, maxHistory: 100 };
      const body = {
        module: m.key,
        action: "settings",
        maxTabs: clamp(Math.round(v.maxTabs) || 10, 2, 50),
        maxHistory: clamp(Math.round(v.maxHistory) || 100, 10, 2000),
      };
      try {
        await fetch("/api/site-tabs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // 单个模块失败不中断其余
      }
    }
    if (agentDirty) {
      const ms = inactivityMin <= 0 ? 0 : clamp(Math.round(inactivityMin), 1, 60) * 60_000;
      try {
        await fetch("/api/agent/preference", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inactivityTimeoutMs: ms }),
        });
        setAgentDirty(false);
      } catch {
        // 忽略
      }
    }
    setSaving(false);
    setDirty(false);
    setSavedTip(true);
  }

  const canSave = loaded && (dirty || agentDirty) && !saving;

  return (
    <>
      <Topbar title="设置" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-[16px] font-semibold">设置</h1>
            <button
              type="button"
              onClick={saveAll}
              disabled={!canSave}
              className="rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {saving ? "保存中…" : "保存设置"}
            </button>
          </div>

          {savedTip ? (
            <div className="mb-3 rounded-[10px] border border-green-200 bg-green-50 px-4 py-2.5 text-[12.5px] text-green-700">
              已保存
            </div>
          ) : null}

          {!loaded ? (
            <div className="py-8 text-center text-[13px] text-ink-faint">加载中…</div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-[10px] border border-line bg-surface px-4 py-3">
                <div className="mb-1 text-[13px] font-medium text-ink">本地 Agent</div>
                <p className="mb-2.5 text-[11.5px] leading-relaxed text-ink-faint">
                  任务总时长不限制，仅在「距上一次网关响应」超过下方时长时视为不活跃超时。工具调用、正文片段等任意响应都会重置计时。
                </p>
                <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                  不活跃超时
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={inactivityMin}
                    onChange={(e) => {
                      setInactivityMin(Number(e.target.value));
                      setAgentDirty(true);
                      setSavedTip(false);
                    }}
                    className="h-7 w-[72px] rounded-md border border-line bg-white px-2 text-center text-[12.5px] outline-none focus:border-accent"
                  />
                  <span className="text-[11px] text-ink-faint">分钟（0 = 禁用，默认 10，最长 60）</span>
                </label>
              </div>

              {MODULES.map((m) => {
                const v = values[m.key] ?? { maxTabs: 10, maxHistory: 100 };
                return (
                  <div key={m.key} className="rounded-[10px] border border-line bg-surface px-4 py-3">
                    <div className="mb-2.5 text-[13px] font-medium text-ink">{m.label}</div>
                    <div className="flex items-center gap-6">
                      <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                        标签上限
                        <input
                          type="number"
                          min={2}
                          max={50}
                          value={v.maxTabs}
                          onChange={(e) => update(m.key, { maxTabs: Number(e.target.value) })}
                          className="h-7 w-[72px] rounded-md border border-line bg-white px-2 text-center text-[12.5px] outline-none focus:border-accent"
                        />
                        <span className="text-[11px] text-ink-faint">2–50</span>
                      </label>
                      <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
                        历史上限
                        <input
                          type="number"
                          min={10}
                          max={2000}
                          value={v.maxHistory}
                          onChange={(e) => update(m.key, { maxHistory: Number(e.target.value) })}
                          className="h-7 w-[80px] rounded-md border border-line bg-white px-2 text-center text-[12.5px] outline-none focus:border-accent"
                        />
                        <span className="text-[11px] text-ink-faint">10–2000</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-6 space-y-2">
            {[
              ["用户数据", "~/snuby-workspace-data（主题库与 Agent 会话）"],
              ["版本", "v0.5"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between rounded-[10px] border border-line bg-surface px-4 py-3 text-[13px]"
              >
                <span className="shrink-0 text-ink">{k}</span>
                <span className="text-right text-ink-faint">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
