import { getWork } from "@/infrastructure/agent-work";
import { checkoutDraft } from "@/infrastructure/agent-work/draft-service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  const body = (await req.json()) as { draftId?: string };
  if (!body.draftId) return Response.json({ error: "draftId 必填" }, { status: 400 });
  const result = checkoutDraft(id, body.draftId);
  if (!result.ok) {
    return Response.json(
      { error: result.message, code: result.code },
      { status: result.code === "not_found" ? 404 : 400 },
    );
  }
  return Response.json(result);
}
