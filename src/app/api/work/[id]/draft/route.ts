// GET/POST/DELETE /api/work/[id]/draft — 当前稿 / 指定稿 / 保存 / 删除版本
import { getWork } from "@/infrastructure/agent-work";
import {
  deleteDraft,
  getCurrentDraft,
  readDraftContent,
  readDraftMeta,
  saveDraft,
  sha1Of,
  type DraftBaseline,
} from "@/infrastructure/agent-work/draft-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  const draftId = new URL(req.url).searchParams.get("draftId");
  if (draftId) {
    const content = readDraftContent(id, draftId);
    if (content === null) return Response.json({ error: "稿件不存在" }, { status: 404 });
    return Response.json({
      draftId,
      content,
      meta: readDraftMeta(id, draftId),
      contentSha1: sha1Of(content),
    });
  }
  const cur = getCurrentDraft(id);
  if (!cur) return Response.json({ error: "稿件不存在" }, { status: 404 });
  return Response.json({
    draftId: cur.draftId,
    content: cur.content,
    meta: cur.meta,
    contentSha1: cur.contentSha1,
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  const body = (await req.json()) as {
    content?: string;
    baseline?: DraftBaseline;
  };
  if (typeof body.content !== "string") {
    return Response.json({ error: "content 必填" }, { status: 400 });
  }
  const result = saveDraft(id, body.content, body.baseline);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 409;
    return Response.json(
      { error: result.message, code: result.code, diskSha1: result.diskSha1 },
      { status },
    );
  }
  return Response.json(result);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  const draftId = new URL(req.url).searchParams.get("draftId");
  if (!draftId) return Response.json({ error: "draftId 必填" }, { status: 400 });
  const result = deleteDraft(id, draftId);
  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 : result.code === "last_draft" ? 409 : 400;
    return Response.json({ error: result.message, code: result.code }, { status });
  }
  return Response.json(result);
}
