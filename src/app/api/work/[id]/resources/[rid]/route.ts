import path from "path";
import { getWork, workDirOf } from "@/infrastructure/agent-work";
import {
  deleteResource,
  renameResource,
  updateResourceNote,
  type ResourcesFile,
} from "@/infrastructure/agent-work/resource-service";

type Ctx = { params: Promise<{ id: string; rid: string }> };

function withAbsolutePaths(workId: string, file: ResourcesFile) {
  const resRoot = path.join(workDirOf(workId), "resources");
  return {
    ...file,
    items: file.items.map((item) => ({
      ...item,
      absolutePath: item.relativePath ? path.join(resRoot, item.relativePath) : null,
    })),
  };
}

function mapResult(
  id: string,
  result:
    | { ok: true; file: ResourcesFile; item?: unknown }
    | { ok: false; code: string; message: string },
) {
  if (!result.ok) {
    return Response.json(
      { error: result.message, code: result.code },
      { status: result.code === "resource_conflict" ? 409 : 404 },
    );
  }
  return Response.json({ ...result, file: withAbsolutePaths(id, result.file) });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id, rid } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  const body = (await req.json()) as {
    name?: string;
    note?: string;
    baseRevision?: number;
  };
  if (typeof body.note === "string") {
    return mapResult(id, updateResourceNote(id, rid, body.note, body.baseRevision));
  }
  if (typeof body.name === "string") {
    return mapResult(id, renameResource(id, rid, body.name, body.baseRevision));
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
  return mapResult(id, result);
}
