import { getWork } from "@/infrastructure/agent-work";
import {
  deleteResource,
  renameResource,
  updateResourceNote,
} from "@/infrastructure/agent-work/resource-service";

type Ctx = { params: Promise<{ id: string; rid: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id, rid } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  const body = (await req.json()) as {
    name?: string;
    note?: string;
    baseRevision?: number;
  };
  if (typeof body.note === "string") {
    const result = updateResourceNote(id, rid, body.note, body.baseRevision);
    if (!result.ok) {
      return Response.json(
        { error: result.message, code: result.code },
        { status: result.code === "resource_conflict" ? 409 : 404 },
      );
    }
    return Response.json(result);
  }
  if (typeof body.name === "string") {
    const result = renameResource(id, rid, body.name, body.baseRevision);
    if (!result.ok) {
      return Response.json(
        { error: result.message, code: result.code },
        { status: result.code === "resource_conflict" ? 409 : 404 },
      );
    }
    return Response.json(result);
  }
  return Response.json({ error: "需要 name 或 note" }, { status: 400 });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id, rid } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  const url = new URL(req.url);
  const revRaw = url.searchParams.get("baseRevision");
  const baseRevision = revRaw != null ? Number(revRaw) : undefined;
  const result = deleteResource(
    id,
    rid,
    Number.isFinite(baseRevision) ? baseRevision : undefined,
  );
  if (!result.ok) {
    return Response.json(
      { error: result.message, code: result.code },
      { status: result.code === "resource_conflict" ? 409 : 404 },
    );
  }
  return Response.json(result);
}
