"use client";

// 轻量 Markdown 编辑：工具条 + 预览（react-markdown）/ 源码切换

import { useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  value: string;
  onChange: (v: string) => void;
  mode: "preview" | "source";
  onModeChange: (m: "preview" | "source") => void;
};

function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder = "",
): { next: string; selStart: number; selEnd: number } {
  const selected = value.slice(start, end) || placeholder;
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  const selStart = start + before.length;
  return { next, selStart, selEnd: selStart + selected.length };
}

export default function WorkMarkdownEditor({ value, onChange, mode, onModeChange }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  const apply = useCallback(
    (before: string, after: string, placeholder?: string) => {
      const el = taRef.current;
      if (!el) {
        onChange(before + (placeholder || "") + after);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const { next, selStart, selEnd } = wrapSelection(value, start, end, before, after, placeholder);
      onChange(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(selStart, selEnd);
      });
    },
    [onChange, value],
  );

  const tools: { label: string; title: string; run: () => void }[] = [
    { label: "B", title: "加粗", run: () => apply("**", "**", "粗体") },
    { label: "I", title: "斜体", run: () => apply("*", "*", "斜体") },
    { label: "H", title: "标题", run: () => apply("\n## ", "\n", "标题") },
    { label: "「」", title: "引用", run: () => apply("\n> ", "\n", "引用") },
    { label: "•", title: "列表", run: () => apply("\n- ", "\n", "列表项") },
    { label: "1.", title: "有序", run: () => apply("\n1. ", "\n", "条目") },
    { label: "链接", title: "链接", run: () => apply("[", "](https://)", "文案") },
    { label: "图", title: "图片", run: () => apply("![", "](resources/)", "描述") },
    { label: "</>", title: "代码", run: () => apply("`", "`", "code") },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 py-1">
        {mode === "source" &&
          tools.map((t) => (
            <button
              key={t.title}
              type="button"
              title={t.title}
              onClick={t.run}
              className="flex h-7 min-w-7 items-center justify-center rounded-[6px] px-1.5 text-[12px] font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              {t.label}
            </button>
          ))}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className={`rounded-[6px] px-2 py-1 text-[12px] ${mode === "preview" ? "bg-accent-soft text-accent-deep" : "text-ink-muted hover:bg-hover"}`}
            onClick={() => onModeChange("preview")}
          >
            预览
          </button>
          <button
            type="button"
            className={`rounded-[6px] px-2 py-1 text-[12px] ${mode === "source" ? "bg-accent-soft text-accent-deep" : "text-ink-muted hover:bg-hover"}`}
            onClick={() => onModeChange("source")}
          >
            源码
          </button>
        </div>
      </div>
      {mode === "source" ? (
        <textarea
          ref={taRef}
          className="min-h-0 flex-1 resize-none bg-surface p-4 font-mono text-[13px] leading-relaxed text-ink outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="开始写作，或让右侧 Agent 起草…"
          spellCheck={false}
        />
      ) : (
        <div className="prose-work min-h-0 flex-1 overflow-auto px-5 py-4 text-[14px] leading-relaxed text-ink">
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <p className="text-ink-faint">暂无内容 — 切到「源码」编辑，或让 Agent 起草</p>
          )}
        </div>
      )}
    </div>
  );
}
