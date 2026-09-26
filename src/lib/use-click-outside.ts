"use client";

// 通用「点击外部关闭」hook: 下拉/浮层打开期间, 点击容器外区域触发 onClose
// 用法: const ref = useRef<HTMLDivElement>(null);
//       useClickOutside(ref, open, () => setOpen(false));
import { useEffect, type RefObject } from "react";

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // mousedown 优先于 click, 避免下拉内按钮点击后又被外部判断误关
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, ref, onClose]);
}
