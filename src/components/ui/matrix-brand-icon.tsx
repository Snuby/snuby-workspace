"use client";

// 自媒体平台本地品牌图标 (public/icons/matrix/*.png ≈ 128²)

import type { ReactNode } from "react";
import { MATRIX_BRAND_ICON_SRC } from "@/lib/matrix-presets";

const FALLBACK = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

type Props = {
  platformId: string;
  /** 边长 px, 默认 15 (侧栏); 顶栏常用 14 */
  size?: number;
  className?: string;
};

/** 已知平台渲染本地 PNG; 未知回退四格线性图标 */
export function MatrixBrandIcon({ platformId, size = 15, className }: Props): ReactNode {
  const src = MATRIX_BRAND_ICON_SRC[platformId];
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 本地静态品牌图
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className={["shrink-0 rounded-[3px] object-cover", className].filter(Boolean).join(" ")}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={["inline-flex shrink-0 items-center justify-center text-current", className]
        .filter(Boolean)
        .join(" ")}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {FALLBACK}
    </span>
  );
}
