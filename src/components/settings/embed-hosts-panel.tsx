// Spec: 014-embed-hosts — 设置页「内嵌白名单」配置面板 (桌面版)
"use client";

import { useEffect, useState } from "react";

type HostsData = { builtin: string[]; custom: string[] };
type SetResult = { ok: true; builtin: string[]; custom: string[] } | { ok: false; invalid: string[] };

declare global {
  interface Window {
    snubyEmbedHosts?: {
      get: () => Promise<HostsData>;
      set: (entries: string[]) => Promise<SetResult>;
    };
  }
}

export default function EmbedHostsPanel() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [builtin, setBuiltin] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const desktop = /electron/i.test(navigator.userAgent);
    setIsDesktop(desktop);
    if (desktop && window.snubyEmbedHosts) {
      window.snubyEmbedHosts
        .get()
        .then((d) => {
          setBuiltin(d.builtin);
          setCustom(d.custom);
        })
        .catch(() => setMsg({ kind: "err", text: "读取白名单失败" }));
    }
  }, []);

  const apply = async (next: string[]) => {
    if (!window.snubyEmbedHosts) return;
    const r = await window.snubyEmbedHosts.set(next);
    if (r.ok) {
      setBuiltin(r.builtin);
      setCustom(r.custom);
      setMsg({ kind: "ok", text: `已保存，立即生效（${r.custom.length} 条自定义）` });
    } else {
      setMsg({ kind: "err", text: `无效条目：${r.invalid.join("、")}（支持如 *.google.com / example.com）` });
    }
  };

  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    void apply([...custom, raw]).then(() => {
      if (!msg || msg.kind === "ok") setDraft("");
    });
  };

  const remove = (host: string) => void apply(custom.filter((h) => h !== host));

  if (!isDesktop) {
    return (
      <div className="mb-2.5 rounded-[10px] border border-line bg-surface px-4 py-3.5 text-[13px] text-ink-faint">
        内嵌白名单（仅桌面版可用——内嵌官网原页的导航放行配置）
      </div>
    );
  }

  return (
    <div className="mb-2.5 rounded-[10px] border border-line bg-surface px-4 py-3.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[13px] text-ink">内嵌 Webview 白名单</span>
        <span className="text-[11.5px] text-ink-faint">桌面版 · 设置即生效</span>
      </div>
      <p className="mb-2.5 text-[12px] leading-relaxed text-ink-faint">
        控制内嵌页面（如 OpenRouter / Artificial Analysis）可导航到的域名。通配 <code>*.google.com</code>{" "}
        表示该域及其全部子域；不带 <code>*.</code> 仅匹配该域名本身。删除或添加后立即生效并持久化。
      </p>

      <div className="mb-2 space-y-1">
        {builtin.map((h) => (
          <div key={`b-${h}`} className="flex items-center justify-between rounded-[8px] bg-ink/[0.03] px-3 py-1.5 text-[12.5px]">
            <span className="font-mono text-ink">{h}</span>
            <span className="text-[11px] text-ink-faint">内置</span>
          </div>
        ))}
        {custom.map((h) => (
          <div key={`c-${h}`} className="flex items-center justify-between rounded-[8px] bg-ink/[0.03] px-3 py-1.5 text-[12.5px]">
            <span className="font-mono text-ink">{h}</span>
            <button type="button" onClick={() => remove(h)} className="text-[11.5px] text-ink-faint hover:text-[#d64541]">
              删除
            </button>
          </div>
        ))}
        {builtin.length === 0 && custom.length === 0 && (
          <div className="py-1 text-[12px] text-ink-faint">暂无条目</div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="添加域名，如 *.google.com"
          className="min-w-0 flex-1 rounded-[8px] border border-line bg-transparent px-3 py-1.5 text-[12.5px] outline-none focus:border-[#3370ff]"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-[8px] bg-[#3370ff] px-4 py-1.5 text-[12.5px] text-white hover:opacity-90"
        >
          添加
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-[12px] ${msg.kind === "ok" ? "text-[#2e7d32]" : "text-[#d64541]"}`}>{msg.text}</p>
      )}
    </div>
  );
}
