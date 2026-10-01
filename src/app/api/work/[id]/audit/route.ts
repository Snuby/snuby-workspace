import { getWork } from "@/infrastructure/agent-work";
import { auditWorkViolations } from "@/infrastructure/agent-work/work-audit";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { sinceMs?: number; cutoffMs?: number };
  const violations = auditWorkViolations(id, {
    sinceMs: body.sinceMs,
    cutoffMs: body.cutoffMs,
  });
  return Response.json({ violations });
}
