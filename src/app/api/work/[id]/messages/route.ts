import { getWork } from "@/infrastructure/agent-work";
import {
  parseScopeRef,
  readCollabMessages,
} from "@/infrastructure/agent-work/collab-messages";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "draft";
  const ref = parseScopeRef({
    scope,
    resourceId: url.searchParams.get("resourceId") || undefined,
    pubId: url.searchParams.get("pubId") || undefined,
  });
  if ("error" in ref) return Response.json({ error: ref.error }, { status: 400 });
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(Number(limitRaw) || 50, 500)) : undefined;
  const cursorRaw = url.searchParams.get("cursor");
  const cursor = cursorRaw !== null && cursorRaw !== "" ? Number(cursorRaw) : undefined;
  const includeInject = url.searchParams.get("includeInject") === "1";
  return Response.json(readCollabMessages(id, ref, { limit, cursor, includeInject }));
}
