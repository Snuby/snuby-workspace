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

type WebviewPolicy = { minKeep: number; retentionHours: number };

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

const WEBVIEW_KEEP_OPTIONS = [5, 10, 15, 20];
const WEBVIEW_RETENTION_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: "1 小时", hours: 1 },
  { label: "3 小时", hours: 3 },
  { label: "24 小时", hours: 24 },
  { label: "3 天", hours: 72 },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, ModuleSettings>>({});
  const [webview, setWebview] = useState<WebviewPolicy>({ minKeep: 5, retentionHours: 3 });
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
      try {
        const res = await fetch("/api/site-tabs?module=webview");
        if (res.ok) {
          const data = await res.json();
          const sv = data.settings as { webviewMinKeep?: number; webviewRetentionHours?: number };
          setWebview({
            minKeep: sv.webviewMinKeep ?? 5,
            retentionHours: sv.webviewRetentionHours ?? 3,
          });
        }
      } catch {
        // 保持默认
      }
      setLoaded(true);
    })();
  }, []);

  function update(key: string, patch: Partial<ModuleSettings>) {
    setValues((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { maxTabs: 10, maxHistory: 100 }), ...patch } }));
    setDirty(true);
    setSavedTip(false);
  }

  function updateWebview(patch: Partial<WebviewPolicy>) {
    setWebview((prev) => ({ ...prev, ...patch }));
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
    // 全局 WebView 保留策略
    try {
      await fetch("/api/site-tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: "webview",
          action: "settings",
          webviewMinKeep: webview.minKeep,
          webviewRetentionHours: webview.retentionHours,
        }),
      });
    } catch {
      // 忽略
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

          <div className="mt-6 rounded-[10px] border border-line bg-surface px-4 py-3">
            <div className="mb-3 text-[13px] font-medium text-ink">
              WebView 保留策略（全局）
              <span className="ml-2 text-[11px] font-normal text-ink-faint">
                站内标签的页面实例跨模块保留，最近使用的保底数量内永不回收
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
              <div>
                <div className="mb-1.5 text-[12px] text-ink-muted">至少保留（最近使用的数量）</div>
                <div className="flex gap-1.5">
                  {WEBVIEW_KEEP_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => updateWebview({ minKeep: n })}
                      className={`h-7 min-w-[40px] rounded-md border px-2 text-[12.5px] transition-colors ${
                        webview.minKeep === n
                          ? "border-accent bg-accent/10 font-medium text-accent-deep"
                          : "border-line bg-white text-ink-muted hover:border-accent"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[12px] text-ink-muted">超出部分按不活跃时长回收</div>
                <div className="flex gap-1.5">
                  {WEBVIEW_RETENTION_OPTIONS.map((o) => (
                    <button
                      key={o.hours}
                      type="button"
                      onClick={() => updateWebview({ retentionHours: o.hours })}
                      className={`h-7 rounded-md border px-2.5 text-[12.5px] transition-colors ${
                        webview.retentionHours === o.hours
                          ? "border-accent bg-accent/10 font-medium text-accent-deep"
                          : "border-line bg-white text-ink-muted hover:border-accent"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-2">
            {[
              ["数据更新方式", "手动触发（宏观「更新数据」/ 行情「更新行情」按钮）"],
              ["数据来源", "国家统计局 · 中国人民银行 · 海关总署 · 中指研究院 等"],
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
