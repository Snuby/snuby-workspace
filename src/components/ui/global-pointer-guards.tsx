"use client";

// 全局指针守卫: 右键不默认选中文字 (输入框 / 可编辑区域除外)

import { useEffect } from "react";

const EDITABLE =
  "input, textarea, [contenteditable='true'], [contenteditable=''], [contenteditable=plaintext-only]";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(EDITABLE));
}

export default function GlobalPointerGuards() {
  useEffect(() => {
    const clearSel = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) sel.removeAllRanges();
    };

    // Chromium 右键常会选中光标下单词: 在 mousedown(button=2) 阶段清掉
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      if (isEditableTarget(e.target)) return;
      clearSel();
    };

    const onContextMenu = (e: Event) => {
      if (isEditableTarget(e.target)) return;
      // 同步清一次 + 下一帧再清, 挡住浏览器默认选词
      clearSel();
      requestAnimationFrame(clearSel);
    };

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, []);

  return null;
}
