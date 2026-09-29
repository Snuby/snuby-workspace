"use client";

// 选项卡图标: 统一用 lucide 线性图标 (公开 favicon 在 Electron/国内站点常失败或不可见)

import type { ReactNode } from "react";

/** lucide 风格线性图标基座 */
export function LucideIcon({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-3.5 w-3.5"}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconGlobe = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
  </LucideIcon>
);

export const IconNewspaper = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
    <path d="M18 14h-8" />
    <path d="M15 18h-5" />
    <path d="M10 6h8v4h-8V6Z" />
  </LucideIcon>
);

export const IconMessages = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <path d="M8.5 14.5c-3 0-5.5-2-5.5-4.5S5.5 5.5 8.5 5.5 14 7.5 14 10c0 .6-.1 1.1-.3 1.6" />
    <path d="M15.5 19.5c3.3 0 6-2.2 6-5s-2.7-5-6-5-6 2.2-6 5c0 1.2.5 2.3 1.4 3.1L10 20l2.2-1.2c1 .4 2.1.7 3.3.7Z" />
  </LucideIcon>
);

export const IconBook = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    <path d="M8 7h8" />
    <path d="M8 11h6" />
  </LucideIcon>
);

export const IconUser = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20a8 8 0 0 1 16 0" />
  </LucideIcon>
);

export const IconRss = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1" />
  </LucideIcon>
);

export const IconCode = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <path d="m16 18 6-6-6-6" />
    <path d="m8 6-6 6 6 6" />
  </LucideIcon>
);

export const IconVideo = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </LucideIcon>
);

export const IconShopping = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </LucideIcon>
);

export const IconHash = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <path d="M4 9h16" />
    <path d="M4 15h16" />
    <path d="M10 3 8 21" />
    <path d="m16 3-2 18" />
  </LucideIcon>
);

export const IconLayers = ({ className }: { className?: string }) => (
  <LucideIcon className={className}>
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </LucideIcon>
);

/**
 * 按平台 id / hostname / 站点名选 lucide 图标。
 * 传入任意组合 (url、label、platformId)，内部拼成关键字匹配。
 */
export function tabIconFor(hint: string, className = "h-3.5 w-3.5"): ReactNode {
  const k = hint.toLowerCase();
  let host = "";
  try {
    if (k.includes("://") || k.startsWith("www.")) host = new URL(k.startsWith("http") ? k : `https://${k}`).hostname;
  } catch {
    host = "";
  }
  const t = `${k} ${host}`;

  if (/weixin|wechat|mp\.weixin|qq\.com/.test(t)) return <IconMessages className={className} />;
  if (/toutiao|bytedance|jinritoutiao/.test(t)) return <IconNewspaper className={className} />;
  if (/xiaohongshu|\bxhs\b|redbook/.test(t)) return <IconBook className={className} />;
  if (/bilibili|youtube|youku|iqiyi|video|视频/.test(t)) return <IconVideo className={className} />;
  if (/github|gitlab|stackoverflow|juejin|csdn|v2ex|code|开发|编程/.test(t)) return <IconCode className={className} />;
  if (/taobao|tmall|jd\.com|amazon|购物|商城|shop/.test(t)) return <IconShopping className={className} />;
  if (/rss|feed|博客|blog|substack/.test(t)) return <IconRss className={className} />;
  if (/news|资讯|36kr|ithome|sspai|少数派|虎嗅|钛媒体|澎湃|zhihu|知乎|头条|日报/.test(t)) {
    return <IconNewspaper className={className} />;
  }
  if (/twitter|x\.com|weibo|社交|社区/.test(t)) return <IconHash className={className} />;
  if (/account|账号|用户|user/.test(t)) return <IconUser className={className} />;
  if (/matrix|平台|platform/.test(t)) return <IconLayers className={className} />;
  return <IconGlobe className={className} />;
}

/** @deprecated 用 tabIconFor; 保留别名避免旧引用断裂 */
export function fallbackIconFor(platformOrHost: string, className = "h-3.5 w-3.5"): ReactNode {
  return tabIconFor(platformOrHost, className);
}

/** @deprecated 公开 favicon 不可靠, 现直接渲染 lucide */
export function SiteFavicon({
  url,
  fallback,
  className,
  size = 14,
}: {
  url?: string | null;
  fallback: ReactNode;
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={["inline-flex shrink-0 items-center justify-center text-current", className]
        .filter(Boolean)
        .join(" ")}
      style={{ width: size, height: size }}
    >
      {url ? tabIconFor(url, "h-3.5 w-3.5") : fallback}
    </span>
  );
}
