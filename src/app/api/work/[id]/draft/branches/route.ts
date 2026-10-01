import { getWork } from "@/infrastructure/agent-work";
import { readBranches } from "@/infrastructure/agent-work/draft-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  return Response.json({ branches: readBranches(id) });
}
