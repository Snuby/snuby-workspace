// POST /api/work/[id]/run — 作品 Agent 执行（scope 历史轨道；ACP 作品级）
import {
  getWork,
  writeWorkMeta,
  workDirOf,
} from "@/infrastructure/agent-work";
import {
  appendCollabMessage,
  parseScopeRef,
  type CollabScopeRef,
} from "@/infrastructure/agent-work/collab-messages";
import { buildWorkPreload } from "@/infrastructure/agent-work/work-preload";
import { auditWorkViolations } from "@/infrastructure/agent-work/work-audit";
import { getResource, updateResourceNote } from "@/infrastructure/agent-work/resource-service";
import {
  getCurrentDraft,
  checkpointDiskIfChanged,
  sha1Of,
} from "@/infrastructure/agent-work/draft-service";
import {
  formatTaskKey,
  resolveAlignReason,
  type AlignReason,
  type WorkCapability,
} from "@/infrastructure/agent-runtime";
import {
  globalQueueSnapshot,
  isLocalSessionBusy,
  markLogicalSessionAligned,
  peekLogicalSessionMarker,
  prompt,
  withGlobalAgentLock,
} from "@/infrastructure/workbuddy-acp";
import { getInactivityTimeoutMs } from "@/infrastructure/agent-session-store";
import { snubyLog } from "@/infrastructure/snuby-log";
import { existsSync, readFileSync } from "fs";
import path from "path";

type Ctx = { params: Promise<{ id: string }> };

const lastScopeByWork = new Map<string, string>();

function scopeKey(ref: CollabScopeRef): string {
  if (ref.scope === "draft") return "draft";
  if (ref.scope === "publish") return `publish:${ref.pubId}`;
  return `resource:${ref.resourceId}`;
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: workId } = await ctx.params;
  const work = getWork(workId);
  if (!work) return Response.json({ error: "作品不存在" }, { status: 404 });

  const body = (await req.json()) as {
    text?: string;
    capability?: WorkCapability | string;
    scope?: string;
    resourceId?: string;
    pubId?: string;
    draftDirty?: boolean;
    inactivityTimeoutMs?: number;
  };

  const text = (body.text ?? "").trim();
  if (!text) return Response.json({ error: "任务内容为空" }, { status: 400 });

  const capability = (body.capability || "general") as string;
  const draftDirty = !!body.draftDirty;

  if (capability === "edit-draft" && draftDirty) {
    return Response.json(
      { error: "编辑器有未保存修改，请先保存或丢弃后再改稿", code: "draft_dirty" },
      { status: 409 },
    );
  }

  const ref = parseScopeRef({
    scope: body.scope || "draft",
    resourceId: body.resourceId,
    pubId: body.pubId,
  });
  if ("error" in ref) return Response.json({ error: ref.error }, { status: 400 });

  const taskKey = formatTaskKey("work", workId);
  // 同作品单 flight
  if (isLocalSessionBusy(taskKey) || isLocalSessionBusy(workId)) {
    return Response.json(
      { error: "作品内任务进行中", code: "work_busy" },
      { status: 409 },
    );
  }

  const inactivityTimeoutMs =
    typeof body.inactivityTimeoutMs === "number" && body.inactivityTimeoutMs >= 0
      ? body.inactivityTimeoutMs
      : getInactivityTimeoutMs();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* gone */
        }
      };
      let clientGone = false;
      const safePush = (obj: unknown) => {
        try {
          push(obj);
        } catch {
          clientGone = true;
        }
      };

      const snap = globalQueueSnapshot();
      if (snap.activeKey && snap.activeKey !== taskKey && snap.activeKey !== workId) {
        safePush({
          type: "queued",
          aheadKey: snap.activeKey,
          aheadTitle: snap.activeKey,
        });
      }

      const sinceMs = Date.now();
      const beforeDraft = getCurrentDraft(workId);
      const beforeSha1 = beforeDraft?.contentSha1 ?? sha1Of("");
      const beforeContent = beforeDraft?.content ?? "";
      try {
        await withGlobalAgentLock(taskKey, async () => {
          safePush({ type: "running" });

          const prevLogical = peekLogicalSessionMarker();
          const switchedTask =
            prevLogical !== null &&
            prevLogical !== taskKey &&
            prevLogical !== workId;
          const bindingMissing = !work.acpSessionId;
          const scopeChanged = lastScopeByWork.get(workId) !== scopeKey(ref);

          const reason: AlignReason = resolveAlignReason({
            bindingMissing,
            gatewayRecreated: false, // align 内若重建由后续指纹处理；此处简化
            switchedTask,
            conventionChanged: false,
            preloadFailed: !!work.preloadFailed,
            firstAlignMarker: prevLogical === null,
          });

          const bundle = buildWorkPreload(workId, {
            reason,
            scope: ref.scope,
            scopeRef: ref,
            capability,
            draftDirty,
            scopeChanged,
            mode: "prefix",
          });
          if (!bundle) throw new Error("预加载失败");

          snubyLog(
            "work",
            `run work=${workId} reason=${reason} scope=${scopeKey(ref)} cap=${capability} setupLen=${bundle.text.length}`,
          );

          const promptText = `${bundle.text}\n\n——\n用户请求：\n${text}`;

          appendCollabMessage(workId, ref, {
            role: "user",
            text,
            kind: "user",
            capability,
            ts: Date.now(),
          });

          let assistant = "";
          const workDir = workDirOf(workId);

          await prompt(
            promptText,
            (e) => {
              if (e.type === "chunk" && typeof (e as { text?: string }).text === "string") {
                assistant += (e as { text: string }).text;
              }
              safePush(e);
              if (!clientGone && (e.type === "permission" || e.type === "done")) {
                try {
                  controller.enqueue(encoder.encode(`${" ".repeat(20 * 1024)}\n`));
                } catch {
                  clientGone = true;
                }
              }
            },
            {
              localSessionId: taskKey,
              acpSessionId: work.acpSessionId,
              cwd: workDir,
              inactivityTimeoutMs,
              bypassGlobalQueue: true,
            },
          );

          markLogicalSessionAligned(taskKey);
          lastScopeByWork.set(workId, scopeKey(ref));

          if (assistant.trim()) {
            appendCollabMessage(workId, ref, {
              role: "assistant",
              text: assistant,
              kind: "assistant",
              capability,
              ts: Date.now(),
            });
          }

          // analyze-url 结束钩子：合并 note-patch
          if (
            (capability === "analyze-url" || capability === "resource-note") &&
            ref.scope === "resource"
          ) {
            const rid = ref.resourceId;
            const patchPath = path.join(workDir, "artifacts", `note-patch-${rid}.md`);
            if (existsSync(patchPath)) {
              try {
                const note = readFileSync(patchPath, "utf8").trim();
                if (note) {
                  const longPath = path.join(workDir, "artifacts", `url-analyze-${rid}.md`);
                  const finalNote = existsSync(longPath)
                    ? `${note}\n长文: artifacts/url-analyze-${rid}.md`
                    : note;
                  updateResourceNote(workId, rid, finalNote);
                }
              } catch {
                /* ignore */
              }
            } else if (assistant.trim() && getResource(workId, rid)) {
              // 无 patch 文件时，用回复前 500 字作短结论（尽力）
              const short = assistant.trim().slice(0, 500);
              updateResourceNote(workId, rid, short);
            }
          }

          const fresh = getWork(workId);
          if (fresh) {
            fresh.preloadFailed = false;
            fresh.conventionFp = bundle.conventionFp;
            writeWorkMeta(fresh);
          }

          // Agent 若改写了正文：落新版本节点，避免「磁盘已变、保存无 diff」
          const cp = checkpointDiskIfChanged(workId, beforeSha1, beforeContent, "AI 修订");
          if (cp.ok && !cp.unchanged) {
            safePush({
              type: "draft_checkpoint",
              draftId: cp.draftId,
              contentSha1: cp.contentSha1,
            });
          }

          const violations = auditWorkViolations(workId, { sinceMs });
          if (violations.length) safePush({ type: "audit", violations });
        });
        safePush({ type: "done" });
      } catch (e) {
        const msg = (e as Error).message || String(e);
        snubyLog("work", `run fail work=${workId}: ${msg}`);
        const fresh = getWork(workId);
        if (fresh) {
          fresh.preloadFailed = true;
          writeWorkMeta(fresh);
        }
        appendCollabMessage(workId, ref, {
          role: "assistant",
          text: msg,
          kind: "assistant",
          error: true,
          capability,
          ts: Date.now(),
        });
        safePush({ type: "error", error: msg });
      } finally {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
