"use client";

// 作品内 Markdown 渲染预览（文章切换 / 稿件预览）— 复用 globals.css 的 .prose-work

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function WorkMdPreview({
  content,
  empty = "（空稿）",
  className = "",
}: {
  content: string;
  empty?: string;
  className?: string;
}) {
  const text = content.trim();
  if (!text) {
    return <div className={`text-[12.5px] text-ink-faint ${className}`}>{empty}</div>;
  }
  return (
    <div className={`prose-work text-[13px] leading-relaxed text-ink ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
