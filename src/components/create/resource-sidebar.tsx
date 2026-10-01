"use client";

// 资源侧栏：添加 / 预览共用；工具栏 → 预览 → 信息+AI 便捷工具（无资源 Agent UI）

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronUp, FileText, Image as ImageIcon, Link2, X } from "lucide-react";
import WorkResourcePreview, {
  PreviewToolbar,
} from "@/components/create/work-resource-preview";
import { PreviewIconBtn } from "@/components/ui/preview-modal";
import { openInSystemBrowser } from "@/lib/open-external";

export type ResourceItem = {
  id: string;
  name: string;
  kind: string;
  url?: string | null;
  relativePath?: string | null;
  absolutePath?: string | null;
  note?: string;
};

const PROMPT_KEY = "snuby:resource-interpret-prompt:v4";

export const DEFAULT_INTERPRET_PROMPT = `站在「后续写稿 / 协作 AI」的视角解读当前资源：想清楚「关于这个资源，我需要提前告诉 AI 什么？」。

分层落盘（重要）：
A. 短 note（必写）：覆盖写入 artifacts/note-patch-<资源id>.md
   - 控制在约 300～480 字
   - 只含：一句话定位 + 3～5 条核心要点 +（可选）1～2 条使用注意
   - 这是进 resources.json 给人和 AI 扫一眼用的，不要写成小作文
B. 详报文件（内容多时必写）：artifacts/resource-brief-<资源id>.md
   - 完整说明书：资源是什么、内容结构、论据/数据、金句、风险与交叉验证
C. 超长原文级分析（可选）：artifacts/url-analyze-<资源id>.md

硬性约束：
- 禁止把思考过程、推理步骤、工具调用说明写进任何落盘文件
- 对话里一两句确认路径即可，不要复述全文`;

export function loadInterpretPrompt(): string {
  try {
    const v = localStorage.getItem(PROMPT_KEY);
    if (v && v.trim()) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_INTERPRET_PROMPT;
}

export function saveInterpretPrompt(text: string) {
  try {
    localStorage.setItem(PROMPT_KEY, text);
  } catch {
    /* ignore */
  }
}

export function clearInterpretPrompt() {
  try {
    localStorage.removeItem(PROMPT_KEY);
  } catch {
    /* ignore */
  }
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-[12px] border border-line bg-surface p-4 shadow-[0_12px_40px_rgba(28,31,36,0.15)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          <PreviewIconBtn title="关闭" onClick={onClose}>
            <X className="h-4 w-4" />
          </PreviewIconBtn>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ResourceSidebar({
  mode,
  resource,
  resNote,
  setResNote,
  running,
  agentPhase,
  onClose,
  onSaveNote,
  onInterpret,
  onAddUrl,
  onPickFiles,
}: {
  mode: "add" | "preview";
  resource: ResourceItem | null;
  resNote: string;
  setResNote: (v: string) => void;
  running: boolean;
  agentPhase: string;
  onClose: () => void;
  onSaveNote: () => void;
  onInterpret: (prompt: string) => void;
  onAddUrl: (url: string, name: string) => void;
  onPickFiles: () => void;
}) {
  const [urlValue, setUrlValue] = useState("");
  const [urlName, setUrlName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(DEFAULT_INTERPRET_PROMPT);
  const [noteOpen, setNoteOpen] = useState(false);
  const [webNav, setWebNav] = useState({ canGoBack: false, canGoForward: false });
  const [location, setLocation] = useState("");
  const navApiRef = useRef<{ goBack: () => void; goForward: () => void } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasNote = Boolean(resNote.trim());
  const locationText =
    location ||
    resource?.url ||
    resource?.absolutePath ||
    resource?.relativePath ||
    resource?.name ||
    "";

  useEffect(() => {
    setLocation(resource?.url || resource?.absolutePath || resource?.name || "");
    setWebNav({ canGoBack: false, canGoForward: false });
    setNoteOpen(false);
    setMenuOpen(false);
    // 仅随资源切换重置导航/note 浮层
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource?.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const openPromptEditor = () => {
    setPromptDraft(loadInterpretPrompt());
    setPromptOpen(true);
    setMenuOpen(false);
  };

  const KindIcon =
    resource?.kind === "url" ? Link2 : resource?.kind === "media" ? ImageIcon : FileText;

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
        {/* ① 工具栏：对齐通用预览 */}
        {mode === "preview" && resource ? (
          <PreviewToolbar
            location={locationText}
            canBack={webNav.canGoBack}
            canForward={webNav.canGoForward}
            onBack={() => navApiRef.current?.goBack()}
            onForward={() => navApiRef.current?.goForward()}
            onOpenExternal={
              resource.url ||
              (resource.absolutePath &&
                /\.(html?|htm)$/i.test(resource.absolutePath || resource.name))
                ? () =>
                    void openInSystemBrowser(
                      resource.url || resource.absolutePath || "",
                    )
                : undefined
            }
            trailing={
              <PreviewIconBtn title="关闭" onClick={onClose}>
                <X className="h-4 w-4" />
              </PreviewIconBtn>
            }
          />
        ) : (
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-page px-3">
            <span className="min-w-0 flex-1 text-[13px] font-semibold text-ink">添加资源</span>
            <PreviewIconBtn title="关闭" onClick={onClose}>
              <X className="h-4 w-4" />
            </PreviewIconBtn>
          </div>
        )}

        {/* ② 预览栏 / 添加区 */}
        <div className="min-h-0 flex-1 overflow-hidden bg-white">
          {mode === "preview" && resource ? (
            <WorkResourcePreview
              kind={resource.kind}
              name={resource.name}
              url={resource.url}
              absolutePath={resource.absolutePath}
              chrome="none"
              onNavState={setWebNav}
              onLocation={setLocation}
              navApiRef={navApiRef}
            />
          ) : (
            <div className="flex h-full flex-col items-stretch justify-center gap-4 p-6">
              <div className="rounded-[12px] border border-dashed border-line bg-page/60 p-5">
                <div className="mb-2 text-[13px] font-medium text-ink">添加链接</div>
                <input
                  className="mb-2 w-full rounded-[8px] border border-line bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/50"
                  placeholder="https://…"
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                />
                <input
                  className="mb-3 w-full rounded-[8px] border border-line bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/50"
                  placeholder="显示名称（可选）"
                  value={urlName}
                  onChange={(e) => setUrlName(e.target.value)}
                />
                <button
                  type="button"
                  className="rounded-[6px] bg-accent px-3 py-1.5 text-[12.5px] text-white hover:bg-accent-deep disabled:opacity-40"
                  disabled={!urlValue.trim()}
                  onClick={() => {
                    onAddUrl(urlValue.trim(), urlName.trim());
                    setUrlValue("");
                    setUrlName("");
                  }}
                >
                  添加链接
                </button>
              </div>
              <div className="rounded-[12px] border border-dashed border-line bg-page/60 p-5 text-center">
                <div className="mb-2 text-[13px] font-medium text-ink">添加本地文件</div>
                <p className="mb-3 text-[12px] text-ink-faint">支持 md / txt / 图片，也可拖入资源列表</p>
                <button
                  type="button"
                  className="rounded-[6px] border border-line bg-white px-3 py-1.5 text-[12.5px] hover:bg-hover"
                  onClick={onPickFiles}
                >
                  选择文件
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ③ 信息 + AI 便捷工具 */}
        {mode === "preview" && resource ? (
          <div className="shrink-0 border-t border-line bg-page px-3 py-3">
            <div className="mb-2 flex items-start gap-2">
              <KindIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{resource.name}</div>
                <div className="mt-0.5 truncate text-[11px] uppercase tracking-wide text-ink-faint">
                  {resource.kind}
                  {resource.url ? ` · ${resource.url}` : ""}
                  {!resource.url && resource.relativePath ? ` · ${resource.relativePath}` : ""}
                </div>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex" ref={menuRef}>
                <button
                  type="button"
                  disabled={running || agentPhase !== "connected"}
                  title={
                    agentPhase !== "connected"
                      ? "请先连接 ACP"
                      : running
                        ? "任务进行中"
                        : "用预设提示解读并写入 note"
                  }
                  className="rounded-l-[7px] bg-accent px-3 py-1.5 text-[12.5px] text-white hover:bg-accent-deep disabled:opacity-40"
                  onClick={() => onInterpret(loadInterpretPrompt())}
                >
                  {running ? "解读中…" : "一键解读"}
                </button>
                <button
                  type="button"
                  aria-label="解读菜单"
                  className="rounded-r-[7px] border-l border-white/25 bg-accent px-1.5 py-1.5 text-white hover:bg-accent-deep"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <ChevronUp className={`h-3.5 w-3.5 transition-transform ${menuOpen ? "" : "rotate-180"}`} />
                </button>
                {menuOpen && (
                  <div className="absolute bottom-full left-0 z-20 mb-1 min-w-[160px] overflow-hidden rounded-[8px] border border-line bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-hover"
                      onClick={openPromptEditor}
                    >
                      编辑预设 Prompt
                    </button>
                  </div>
                )}
              </div>
              <span className="text-[11px] text-ink-faint">
                {agentPhase !== "connected" ? "需先连接网关" : "短结论进 note，详报进 artifacts"}
              </span>
            </div>

            <div className="rounded-[8px] border border-line bg-white px-2.5 py-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-ink-faint">资源 note</span>
                {hasNote ? (
                  <span className="rounded bg-down-soft px-1.5 py-0.5 text-[10px] text-down">已有内容</span>
                ) : (
                  <span className="rounded bg-ink/8 px-1.5 py-0.5 text-[10px] text-ink-faint">暂无</span>
                )}
              </div>
              {hasNote ? (
                <p className="mb-2 line-clamp-3 text-[12px] leading-relaxed text-ink-muted">
                  {resNote.trim()}
                </p>
              ) : (
                <p className="mb-2 text-[12px] text-ink-faint">
                  尚无 note。可用「一键解读」生成，或手动填写。
                </p>
              )}
              {hasNote ? (
                <p className="mb-2 text-[10px] text-ink-faint">
                  存于 resources.json · 宜短（约 ≤480 字）；过长会落到 artifacts 详报文件
                  {/详报:|长文:/.test(resNote) ? " · 本 note 已挂文件路径" : ""}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="rounded-[6px] border border-line px-2 py-1 text-[12px] hover:bg-hover disabled:opacity-40"
                  disabled={!hasNote}
                  onClick={() => setNoteOpen(true)}
                >
                  预览 note
                </button>
                <button
                  type="button"
                  className="rounded-[6px] border border-line px-2 py-1 text-[12px] hover:bg-hover"
                  onClick={() => setNoteOpen(true)}
                >
                  手动修改
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {promptOpen && (
        <Modal title="编辑解读 Prompt" onClose={() => setPromptOpen(false)}>
          <p className="mb-2 text-[12px] text-ink-faint">
            引导 AI 把资源整理成「后续协作说明书」：这是什么、讲什么、要点与注意什么；结果写入 note。
          </p>
          <textarea
            className="mb-3 h-48 w-full resize-none rounded-[8px] border border-line bg-white p-2.5 text-[12.5px] leading-relaxed outline-none focus:border-accent/50"
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-[6px] px-3 py-1.5 text-[13px] text-ink-muted hover:bg-hover"
              onClick={() => setPromptDraft(DEFAULT_INTERPRET_PROMPT)}
            >
              还原系统 Prompt
            </button>
            <button
              type="button"
              className="rounded-[6px] px-3 py-1.5 text-[13px] hover:bg-hover"
              onClick={() => setPromptOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-deep"
              onClick={() => {
                const t = promptDraft.trim() || DEFAULT_INTERPRET_PROMPT;
                if (t === DEFAULT_INTERPRET_PROMPT) clearInterpretPrompt();
                else saveInterpretPrompt(t);
                setPromptOpen(false);
              }}
            >
              保存
            </button>
          </div>
        </Modal>
      )}

      {noteOpen && (
        <Modal title="资源 note" onClose={() => setNoteOpen(false)}>
          <textarea
            className="mb-2 h-56 w-full resize-none rounded-[8px] border border-line bg-white p-2.5 text-[13px] leading-relaxed outline-none focus:border-accent/50"
            value={resNote}
            onChange={(e) => setResNote(e.target.value)}
            placeholder="记录要点、引用、解读结论…"
          />
          <div className="mb-3 text-[11px] text-ink-faint">{resNote.length} 字</div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-[6px] px-3 py-1.5 text-[13px] hover:bg-hover"
              onClick={() => setNoteOpen(false)}
            >
              关闭
            </button>
            <button
              type="button"
              className="rounded-[6px] bg-ink px-3 py-1.5 text-[13px] text-white hover:bg-ink/90"
              onClick={() => {
                onSaveNote();
                setNoteOpen(false);
              }}
            >
              保存 note
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
