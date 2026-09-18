// Spec: 001-workbench-mvp — 工作台首页 (US-1 AC3)

import Link from "next/link";
import Topbar from "@/components/workbench/topbar";

export default function HomePage() {
  return (
    <>
      <Topbar title="工作台" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-8 py-10">
          <h1 className="text-[21px] font-semibold">下午好，苏伟杰</h1>
          <p className="mt-1.5 mb-7 text-[13px] text-ink-faint">
            这里是 Snuby 工作台，从左侧菜单或下方卡片进入各模块。
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            <Link
              href="/macro"
              className="rounded-xl border border-line bg-surface p-5 transition hover:-translate-y-px hover:shadow-md"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
                <svg viewBox="0 0 24 24" fill="none" stroke="#185FA5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M3 3v18h18" />
                  <path d="M7 14l4-5 3 3 5-7" />
                </svg>
              </div>
              <div className="mb-1.5 text-[14.5px] font-semibold">国家经济数据</div>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                中国宏观经济大盘：GDP、物价、PMI、货币社融、进出口、房地产等
                25 项核心指标，每周一自动更新。
              </p>
              <span className="mt-3 inline-block rounded-md bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                进入模块
              </span>
            </Link>

            <div className="rounded-xl border border-line bg-surface p-5 opacity-60">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#E1F5EE]">
                <svg viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 10h18" />
                </svg>
              </div>
              <div className="mb-1.5 text-[14.5px] font-semibold">行业观察</div>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                行业景气度与细分赛道数据（规划中）。
              </p>
              <span className="mt-3 inline-block rounded-md bg-black/5 px-2 py-0.5 text-[11px] text-ink-faint">
                敬请期待
              </span>
            </div>

            <div className="rounded-xl border border-line bg-surface p-5 opacity-60">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#FAEEDA]">
                <svg viewBox="0 0 24 24" fill="none" stroke="#854F0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
              </div>
              <div className="mb-1.5 text-[14.5px] font-semibold">跟踪提醒</div>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                关键指标异动与数据发布提醒（规划中）。
              </p>
              <span className="mt-3 inline-block rounded-md bg-black/5 px-2 py-0.5 text-[11px] text-ink-faint">
                敬请期待
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
