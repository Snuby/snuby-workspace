// Work 预加载组装（方案 A 软隔离；永不内联 content.md）

import { createHash } from "crypto";
import { existsSync, readdirSync, writeFileSync, mkdirSync, renameSync } from "fs";
import path from "path";
import type {
  AlignReason,
  PreloadBundle,
  PreloadSegment,
  WorkCapability,
  WorkCollabScope,
} from "@/infrastructure/agent-runtime";
import { isFullPreload } from "@/infrastructure/agent-runtime";
import { getWork, workDirOf, contentPathOf } from "./work-repository";
import { readBranches } from "./draft-service";
import { readResources, getResource } from "./resource-service";
import {
  type CollabScopeRef,
  collabMessagesPath,
  recentCollabSnippet,
} from "./collab-messages";

function sha1(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

function seg(id: string, layer: "L0" | "L1" | "L2", text: string): PreloadSegment {
  return { id, layer, bytes: Buffer.byteLength(text, "utf8"), sha1: sha1(text).slice(0, 16) };
}

const RUNTIME_L0 = `【作品创作 · 工作约定】
你正在「作品创作」工作区内与用户协作。
- 唯一授权工作区：{{workDir}}
- 忽略进程 pwd / 临时目录；读写用绝对路径
- 严禁读写工作区以外路径（其他 agent-works、agent-sessions 等）
- meta.json / resources.json / drafts-branches.json / collab 历史：可 Read，不要手改（宿主维护）
- 当前稿正文路径见下文；默认不要把全文塞进回复，需要时 Read
- 编辑器未保存时禁止写当前 content.md
- 资源引用用 resources/ 相对 work 根的路径
- 本轮只处理宿主声明的 scope；忽略其他对话轨道闲聊；权威历史见对应 collab 文件
- 不要自建 draft 版本目录；版本由用户保存产生
- 中间产物写 artifacts/；发布仅在 publish-prepare 能力下写 publish/
`;

export type BuildWorkPreloadOpts = {
  reason: AlignReason;
  scope: WorkCollabScope;
  scopeRef: CollabScopeRef;
  capability?: WorkCapability | string;
  draftDirty?: boolean;
  scopeChanged?: boolean;
  mode?: "prefix" | "standalone";
};

export function buildWorkPreload(workId: string, opts: BuildWorkPreloadOpts): PreloadBundle | null {
  const work = getWork(workId);
  if (!work) return null;
  const workDir = workDirOf(workId);
  const full = isFullPreload(opts.reason);
  const mode = opts.mode ?? "prefix";
  const segments: PreloadSegment[] = [];
  const parts: string[] = [];

  const push = (id: string, layer: "L0" | "L1" | "L2", text: string) => {
    parts.push(text);
    segments.push(seg(id, layer, text));
  };

  const head =
    mode === "prefix"
      ? "【工作约定 · 请记住以下边界，然后直接处理文末的用户请求；勿单独回复「已就绪」】"
      : "【工作约定 · 请仅记住，无需执行任何操作，也不要回复确认】";
  push("head", "L0", head);

  const runtime = RUNTIME_L0.replace(/\{\{workDir\}\}/g, workDir);
  push("runtime", "L0", runtime);

  const contentPath = contentPathOf(workId, work.currentDraftId);
  const scopeHistPath = collabMessagesPath(workId, opts.scopeRef);

  if (full) {
    push(
      "meta",
      "L1",
      `作品 meta（全文）：\n${JSON.stringify(
        {
          id: work.id,
          title: work.title,
          type: work.type,
          status: work.status,
          currentDraftId: work.currentDraftId,
        },
        null,
        2,
      )}`,
    );
  }

  push(
    "current_draft_ptr",
    "L1",
    `当前稿件指针：draftId=${work.currentDraftId}\n正文路径（勿假定已内联）：${contentPath}\neditorDirty=${!!opts.draftDirty}`,
  );

  const resources = readResources(workId);
  const resLines = resources.items
    .slice(0, 40)
    .map((r) => {
      const note = r.note ? ` note=${r.note.slice(0, 80)}${r.note.length > 80 ? "…" : ""}` : "";
      return `- ${r.id} [${r.kind}] ${r.name}${r.url ? ` url=${r.url}` : ""}${r.relativePath ? ` path=resources/${r.relativePath}` : ""}${note}`;
    })
    .join("\n");
  push(
    "resources_index",
    "L1",
    `资源清单 (revision=${resources.revision}, count=${resources.items.length})：\n${resLines || "- （空）"}`,
  );

  if (full) {
    const branches = readBranches(workId);
    push(
      "draft_graph",
      "L1",
      `草稿版本图：\n${JSON.stringify(branches?.nodes ?? [], null, 2)}\ncurrentId=${branches?.currentId}`,
    );

    const artDir = path.join(workDir, "artifacts");
    let arts = "- （空）";
    if (existsSync(artDir)) {
      const names = readdirSync(artDir)
        .filter((n) => !n.startsWith("."))
        .slice(0, 40);
      arts = names.map((n) => `- ${path.join(artDir, n)}`).join("\n") || "- （空）";
    }
    push("artifacts_list", "L1", `artifacts：\n${arts}`);
  }

  // 方案 A：每轮附当前 scope 历史摘录
  const hist = recentCollabSnippet(workId, opts.scopeRef, 24);
  push(
    "history_snippet",
    "L1",
    hist.trim()
      ? `本轨道（scope=${opts.scope}）近期对话摘录：\n${hist}`
      : `本轨道（scope=${opts.scope}）尚无对话摘录。完整历史文件：${scopeHistPath}`,
  );

  const scopeDeclare = `【本轮轨道】scope=${opts.scope}${opts.scopeRef.scope === "resource" ? ` resourceId=${opts.scopeRef.resourceId}` : ""}${opts.scopeRef.scope === "publish" ? ` pubId=${opts.scopeRef.pubId}` : ""}
请只处理本轨道任务；忽略其他轨道闲聊。权威历史：${scopeHistPath}
capability=${opts.capability ?? "general"}`;
  push("scope_declare", "L1", scopeDeclare);

  if (opts.scope === "resource" && opts.scopeRef.scope === "resource") {
    const item = getResource(workId, opts.scopeRef.resourceId);
    if (item) {
      push(
        "capability_addon",
        "L2",
        `目标资源：${JSON.stringify(item, null, 2)}\n分析 url 时：note 写短结论；长文写 artifacts/url-analyze-${item.id}.md 并在 note 中挂路径。`,
      );
    }
  }
  if (opts.scope === "publish" && opts.scopeRef.scope === "publish") {
    push(
      "capability_addon",
      "L2",
      `发布项 pubId=${opts.scopeRef.pubId}；用户不可手改产物，由你写入 publish/（建议 staging）。fromDraft 默认当前稿 ${work.currentDraftId}。`,
    );
  }
  if (opts.capability === "edit-draft") {
    push(
      "capability_addon",
      "L2",
      opts.draftDirty
        ? "【禁止】编辑器有未保存修改，禁止写入 content.md。"
        : `可以修订当前稿：${contentPath}`,
    );
  }

  const tail =
    mode === "prefix"
      ? "以上是工作边界；请据此处理下面的用户请求，直接开始工作。"
      : "若已理解，请只回复「已就绪」三个字并结束本轮。";
  push("tail", "L0", tail);

  const text = parts.join("\n\n");
  const conventionFp = sha1(RUNTIME_L0).slice(0, 16);
  const bundle: PreloadBundle = {
    reason: opts.reason,
    full,
    suggestedMode: mode,
    text,
    contentFp: sha1(text).slice(0, 16),
    conventionFp,
    segments,
    workspaceRoot: workDir,
    facts: {
      workId,
      currentDraftId: work.currentDraftId,
      contentPath,
      draftDirty: !!opts.draftDirty,
      resourceCount: resources.items.length,
      scope: opts.scope,
      capability: opts.capability as WorkCapability | undefined,
      scopeChanged: opts.scopeChanged,
      resourceId: opts.scopeRef.scope === "resource" ? opts.scopeRef.resourceId : undefined,
      pubId: opts.scopeRef.scope === "publish" ? opts.scopeRef.pubId : undefined,
    },
  };

  // 落盘 context-state（尽力）
  try {
    const statePath = path.join(workDir, "context-state.json");
    const tmp = `${statePath}.${process.pid}.tmp`;
    const payload = {
      schemaVersion: 1,
      conventionFp,
      lastPreloadContentFp: bundle.contentFp,
      lastFullPreloadReason: full ? opts.reason : undefined,
      lastFullPreloadAt: full ? Date.now() : undefined,
      lastScope: opts.scope,
      segments: bundle.segments,
    };
    mkdirSync(workDir, { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tmp, statePath);
  } catch {
    /* ignore */
  }

  return bundle;
}

export function listArtifactNames(workId: string): string[] {
  const d = path.join(workDirOf(workId), "artifacts");
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((n) => !n.startsWith("."));
}
