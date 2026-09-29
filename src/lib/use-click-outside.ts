"use client";

// 通用「点击外部关闭」hook: 下拉/浮层打开期间, 点击容器外区域触发 onClose
// 在捕获阶段吞掉事件, 避免关闭菜单的那次点击透传到下层
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
    let closed = false;
    const swallow = (e: Event) => {
      const el = ref.current;
      if (!el || el.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!closed) {
        closed = true;
        onClose();
      }
    };
    document.addEventListener("pointerdown", swallow, true);
    document.addEventListener("mousedown", swallow, true);
    document.addEventListener("click", swallow, true);
    document.addEventListener("contextmenu", swallow, true);
    return () => {
      document.removeEventListener("pointerdown", swallow, true);
      document.removeEventListener("mousedown", swallow, true);
      document.removeEventListener("click", swallow, true);
      document.removeEventListener("contextmenu", swallow, true);
    };
  }, [open, ref, onClose]);
}
