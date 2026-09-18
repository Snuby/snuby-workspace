// Spec: 001-workbench-mvp — 设置页 (US-1 AC4)

import Topbar from "@/components/workbench/topbar";

const ITEMS: Array<[string, string]> = [
  ["数据更新频率", "每周一 09:00 自动抓取"],
  ["数据存储", "SQLite（data/china_economy.db）"],
  ["数据来源", "国家统计局 · 中国人民银行 · 海关总署 · akshare"],
  ["规格文档", "docs/specs/001-workbench-mvp"],
  ["版本", "v0.1"],
];

export default function SettingsPage() {
  return (
    <>
      <Topbar title="设置" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-xl px-8 py-10">
          <h1 className="mb-4 text-[18px] font-semibold">设置</h1>
          {ITEMS.map(([k, v]) => (
            <div
              key={k}
              className="mb-2.5 flex items-center justify-between rounded-[10px] border border-line bg-surface px-4 py-3.5 text-[13px]"
            >
              <span className="text-ink">{k}</span>
              <span className="text-ink-faint">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
