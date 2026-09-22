"use client";

// Spec: 010-ai-vc-watch — 人工录入表单 (Client, US-4)
// 中文源反爬不可程序化抓取 (design 决策 6) → 表单录入; 服务端校验 400 / 同链接 409 + 强制确认。
// 字段: 公司* / 日期* / 轮次(预置+自定义) / 金额+币种 / 赛道(缺省自动分类) / 链接 / 备注

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CURRENCY_OPTIONS, ROUND_OPTIONS, SECTOR_LABELS } from "@/domain/vc";

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "success" }
  | { phase: "error"; errors: string[] }
  | { phase: "duplicate"; duplicateUrl: string };

function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function DealForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  const [force, setForce] = useState(false);

  const [company, setCompany] = useState("");
  const [announcedAt, setAnnouncedAt] = useState(todayLocal());
  const [round, setRound] = useState("");
  const [customRound, setCustomRound] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [sector, setSector] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");

  const inputCls =
    "rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent";
  const labelCls = "mb-1 block text-[11.5px] text-ink-muted";

  async function submit() {
    if (state.phase === "submitting") return;
    setState({ phase: "submitting" });
    try {
      const body: Record<string, unknown> = {
        company,
        announcedAt,
        notes: notes || undefined,
        url: url || undefined,
      };
      if (round === "custom") {
        if (customRound.trim()) body.round = customRound.trim();
      } else if (round) {
        body.round = round;
      }
      if (amount) {
        body.amount = Number(amount);
        body.currency = currency;
      }
      if (sector) body.sector = sector;

      const res = await fetch("/api/vc/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, force }),
      });
      if (res.status === 201) {
        setState({ phase: "success" });
        setCompany("");
        setAmount("");
        setUrl("");
        setNotes("");
        setRound("");
        setCustomRound("");
        setSector("");
        setForce(false);
        router.refresh();
      } else if (res.status === 409) {
        const data = await res.json();
        setState({ phase: "duplicate", duplicateUrl: data.error ?? "" });
      } else {
        const data = await res.json();
        setState({ phase: "error", errors: data.errors ?? [data.error ?? "提交失败"] });
      }
    } catch {
      setState({ phase: "error", errors: ["网络异常，请重试"] });
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[13px] font-medium">
          {open ? "收起录入" : "手动录入融资事件（中文源）"}
        </span>
        <span
          className={[
            "text-ink-faint transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
        >
          ▾
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-4 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>公司 *</label>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="如：智谱AI"
                className={`${inputCls} w-full`}
              />
            </div>
            <div>
              <label className={labelCls}>公告日期 *</label>
              <input
                type="date"
                value={announcedAt}
                max={todayLocal()}
                onChange={(e) => setAnnouncedAt(e.target.value)}
                className={`${inputCls} w-full`}
              />
            </div>
            <div>
              <label className={labelCls}>轮次（可选）</label>
              <select
                value={round}
                onChange={(e) => setRound(e.target.value)}
                className={`${inputCls} w-full`}
              >
                <option value="">未披露</option>
                {ROUND_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                <option value="custom">自定义…</option>
              </select>
            </div>
            {round === "custom" ? (
              <div>
                <label className={labelCls}>自定义轮次</label>
                <input
                  value={customRound}
                  onChange={(e) => setCustomRound(e.target.value)}
                  placeholder="如：战略融资"
                  className={`${inputCls} w-full`}
                />
              </div>
            ) : null}
            <div>
              <label className={labelCls}>金额（可选）</label>
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="原币金额"
                className={`${inputCls} w-full`}
              />
            </div>
            <div>
              <label className={labelCls}>币种</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className={`${inputCls} w-full`}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>赛道（留空自动分类）</label>
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className={`${inputCls} w-full`}
              >
                <option value="">自动分类</option>
                {Object.entries(SECTOR_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>原文链接（可选）</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…（重复链接会提示确认）"
                className={`${inputCls} w-full`}
              />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className={labelCls}>备注（可选，参与赛道分类）</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="如：国产大模型，北京市国资领投"
                className={`${inputCls} w-full`}
              />
            </div>
          </div>

          {state.phase === "error" ? (
            <ul className="mt-3 space-y-0.5 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {state.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}

          {state.phase === "duplicate" ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <span className="min-w-0 flex-1 truncate">{state.duplicateUrl}</span>
              <button
                type="button"
                onClick={() => setForce(true)}
                className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:opacity-90"
              >
                同一链接多轮次，仍要录入
              </button>
              <button
                type="button"
                onClick={() => setState({ phase: "idle" })}
                className="shrink-0 text-amber-900 underline"
              >
                取消
              </button>
            </div>
          ) : null}

          {state.phase === "success" ? (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
              已收录，事件流已刷新。
            </p>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={state.phase === "submitting"}
              className={[
                "rounded-lg px-4 py-1.5 text-[12.5px] font-medium text-white transition-colors",
                state.phase === "submitting"
                  ? "cursor-not-allowed bg-black/20"
                  : "bg-accent hover:opacity-90",
              ].join(" ")}
            >
              {state.phase === "submitting" ? "提交中…" : "收录"}
            </button>
            <span className="text-[11.5px] text-ink-faint">
              金额自动换算 USD 近似用于聚合（汇率常量，非实时）。
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
