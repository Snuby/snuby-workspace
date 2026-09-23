// Spec: 001-workbench-mvp — 设置页 (US-1 AC4); 015 重新排版: 去白名单面板 / 精简无用项 / 减少留白

import Topbar from "@/components/workbench/topbar";

const ITEMS: Array<[string, string]> = [
  ["数据更新方式", "手动触发（宏观「更新数据」/ 行情「更新行情」按钮）"],
  ["数据来源", "国家统计局 · 中国人民银行 · 海关总署 · 中指研究院 等"],
  ["版本", "v0.4"],
];

export default function SettingsPage() {
  return (
    <>
      <Topbar title="设置" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <h1 className="mb-4 text-[16px] font-semibold">设置</h1>
          {ITEMS.map(([k, v]) => (
            <div
              key={k}
              className="mb-2 flex items-center justify-between rounded-[10px] border border-line bg-surface px-4 py-3 text-[13px]"
            >
              <span className="shrink-0 text-ink">{k}</span>
              <span className="text-right text-ink-faint">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
