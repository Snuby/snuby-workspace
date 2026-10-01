// GET/POST /api/work/[id]/draft — 当前稿 / 保存
import { getWork } from "@/infrastructure/agent-work";
import {
  getCurrentDraft,
  saveDraft,
  type DraftBaseline,
} from "@/infrastructure/agent-work/draft-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
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
