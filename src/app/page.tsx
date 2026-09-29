import Link from "next/link";
import Topbar from "@/components/workbench/topbar";

const CARDS = [
  {
    href: "/topic/leaderboard",
    badge: "AI 模型榜单",
    title: "权威榜单",
    desc: "桌面版内嵌官网原页（Artificial Analysis / OpenRouter 用量排名）。",
    iconBg: "bg-accent-soft",
    iconStroke: "#1150B0",
    ctaBg: "bg-accent-soft",
    ctaText: "text-accent-deep",
    icon: (
      <>
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M7 4h10" />
        <path d="M17 4v8a5 5 0 0 1-10 0V4" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
  },
  {
    href: "/topic/it-news",
    badge: "IT 资讯",
    title: "媒体资讯",
    desc: "权威 IT 媒体内嵌阅读，可添加自定义媒体。",
    iconBg: "bg-accent-soft",
    iconStroke: "#1150B0",
    ctaBg: "bg-accent-soft",
    ctaText: "text-accent-deep",
    icon: (
      <>
        <path d="M4 5h15v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
        <path d="M19 8h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2" />
        <path d="M8 9h7" />
        <path d="M8 13h7" />
        <path d="M8 17h4" />
      </>
    ),
  },
  {
    href: "/topic/creators",
    badge: "自媒体",
    title: "创作后台",
    desc: "小红书创作中心与微信公众号后台，登录态持久保留。",
    iconBg: "bg-accent-soft",
    iconStroke: "#1150B0",
    ctaBg: "bg-accent-soft",
    ctaText: "text-accent-deep",
    icon: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </>
    ),
  },
  {
    href: "/browser",
    badge: "Web 访问",
    title: "简易浏览器",
    desc: "自填网址的简易浏览器（前进 / 后退 / 刷新 / 主页）。",
    iconBg: "bg-accent-soft",
    iconStroke: "#1150B0",
    ctaBg: "bg-accent-soft",
    ctaText: "text-accent-deep",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
      </>
    ),
  },
  {
    href: "/lab/local-agent",
    badge: "本地 Agent",
    title: "WorkBuddy 协作",
    desc: "对接本机 ACP 网关，多会话隔离的本地 Agent 工作台。",
    iconBg: "bg-accent-soft",
    iconStroke: "#1150B0",
    ctaBg: "bg-accent-soft",
    ctaText: "text-accent-deep",
    icon: (
      <>
        <path d="M9 3h6" />
        <path d="M10 3v6.3L4.7 19a2 2 0 0 0 1.8 3h11a2 2 0 0 0 1.8-3L14 9.3V3" />
        <path d="M7 15h10" />
      </>
    ),
  },
] as const;

export default function HomePage() {
  return (
    <>
      <Topbar title="工作台" />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-8 py-10">
          <h1 className="text-[21px] font-semibold">Snuby 工作台</h1>
          <p className="mt-1.5 mb-7 text-[13px] text-ink-faint">
            主题浏览（IT 资讯 / 自媒体 / AI 榜单）、Web 访问与本地 Agent。可从左侧导航或下方卡片进入。
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {CARDS.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="rounded-[8px] border border-line bg-surface p-5 transition-colors duration-150 hover:border-accent/30"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-[6px] ${c.iconBg}`}>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={c.iconStroke}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                    >
                      {c.icon}
                    </svg>
                  </div>
                  <span className="rounded-[6px] bg-hover px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                    {c.badge}
                  </span>
                </div>
                <div className="mb-1.5 text-[14.5px] font-semibold">{c.title}</div>
                <p className="text-[12.5px] leading-relaxed text-ink-muted">{c.desc}</p>
                <span className={`mt-3 inline-block rounded-[6px] px-2 py-0.5 text-[11px] ${c.ctaBg} ${c.ctaText}`}>
                  进入
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
