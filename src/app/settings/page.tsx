"use client";

// Spec: 017-site-tabs — 设置页: 站点标签页按模块独立配置 (maxTabs 2-50 / maxHistory 10-2000)
// 读取/写入 /api/site-tabs (SQLite site_settings 表)。

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
    setSaving(false);
    setDirty(false);
    setSavedTip(true);
  }

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
              disabled={!dirty || saving || !loaded}
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
