"use client";

// 右键/下拉菜单层: 全屏透明遮罩吞掉关闭点击, 不透传到下层

import type { ReactNode, SyntheticEvent } from "react";

type Props = {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  /** 预估菜单宽高, 用于贴边 (可选) */
  estimateWidth?: number;
  estimateHeight?: number;
  className?: string;
};

export function ContextMenuLayer({
  x,
  y,
  onClose,
  children,
  estimateWidth = 160,
  estimateHeight = 120,
  className,
}: Props) {
  const left = Math.min(x, typeof window !== "undefined" ? window.innerWidth - estimateWidth : x);
  const top = Math.min(y, typeof window !== "undefined" ? window.innerHeight - estimateHeight : y);

  const swallowClose = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <>
      {/* 捕获层: 左键/右键都只关菜单, 不向底层透传 */}
      <div
        className="fixed inset-0 z-[199]"
        aria-hidden
        onMouseDown={swallowClose}
        onClick={swallowClose}
        onContextMenu={swallowClose}
      />
      <div
        role="menu"
        className={
          className ??
          "fixed z-[200] min-w-[120px] overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg select-none"
        }
        style={{ left, top }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children}
      </div>
    </>
  );
}

export function ContextMenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={[
        "flex w-full px-3 py-1.5 text-left text-[13px] hover:bg-hover",
        danger ? "text-red-600" : "text-ink",
      ].join(" ")}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
