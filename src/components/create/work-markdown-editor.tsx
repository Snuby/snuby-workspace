"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { MDXEditorMethods } from "@mdxeditor/editor";

type Mode = "preview" | "source";

type Props = {
  value: string;
  onChange: (next: string) => void;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
};

const Editor = dynamic(() => import("./initialized-mdx-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-[13px] text-ink-faint">
      加载编辑器…
    </div>
  ),
});

export default function WorkMarkdownEditor({ value, onChange, mode, onModeChange }: Props) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const lastExternalValue = useRef(value);
  const editingRef = useRef(false);

  // 外部换稿 / 加载时同步到所见即所得编辑器
  useEffect(() => {
    if (mode !== "preview") return;
    if (editingRef.current) return;
    if (value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    editorRef.current?.setMarkdown(value);
  }, [value, mode]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[12px] text-ink-faint">
          {mode === "preview" ? "所见即所得" : "Markdown 源码"}
        </span>
        <div className="flex rounded-[6px] border border-line p-0.5 text-[12px]">
          <button
            type="button"
            className={`rounded-[4px] px-2.5 py-0.5 ${
              mode === "preview" ? "bg-ink text-white" : "text-ink-muted hover:text-ink"
            }`}
            onClick={() => onModeChange("preview")}
          >
            编辑
          </button>
          <button
            type="button"
            className={`rounded-[4px] px-2.5 py-0.5 ${
              mode === "source" ? "bg-ink text-white" : "text-ink-muted hover:text-ink"
            }`}
            onClick={() => onModeChange("source")}
          >
            源码
          </button>
        </div>
      </div>

      {mode === "preview" ? (
        <div className="work-mdx-editor min-h-0 flex-1 overflow-auto">
          <Editor
            editorRef={editorRef}
            markdown={value}
            contentEditableClassName="prose-work max-w-none px-5 py-4 outline-none"
            onChange={(md) => {
              editingRef.current = true;
              lastExternalValue.current = md;
              onChange(md);
              queueMicrotask(() => {
                editingRef.current = false;
              });
            }}
          />
        </div>
      ) : (
        <textarea
          className="min-h-0 flex-1 resize-none overflow-auto bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed text-ink outline-none"
          value={value}
          spellCheck={false}
          placeholder="在此编辑 Markdown 源码…"
          onChange={(e) => {
            const next = e.target.value;
            lastExternalValue.current = next;
            onChange(next);
          }}
        />
      )}
    </div>
  );
}
