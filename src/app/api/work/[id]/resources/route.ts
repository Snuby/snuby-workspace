import { getWork } from "@/infrastructure/agent-work";
import {
  addFileBufferResource,
  addUrlResource,
  readResources,
} from "@/infrastructure/agent-work/resource-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });
  return Response.json(readResources(id));
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!getWork(id)) return Response.json({ error: "作品不存在" }, { status: 404 });

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const baseRevisionRaw = form.get("baseRevision");
    const baseRevision =
      baseRevisionRaw != null && String(baseRevisionRaw) !== ""
        ? Number(baseRevisionRaw)
        : undefined;
    if (!(file instanceof File)) {
      return Response.json({ error: "需要 file 字段" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const result = addFileBufferResource(id, {
      name: file.name,
      buffer: buf,
      mime: file.type || undefined,
      note: String(form.get("note") || "") || undefined,
      baseRevision: Number.isFinite(baseRevision) ? baseRevision : undefined,
    });
    if (!result.ok) {
      const status =
        result.code === "resource_type_unsupported"
          ? 415
          : result.code === "resource_conflict"
            ? 409
            : 400;
      return Response.json({ error: result.message, code: result.code }, { status });
    }
    return Response.json(result, { status: 201 });
  }

  const body = (await req.json()) as {
    kind?: string;
    name?: string;
    url?: string;
    note?: string;
    baseRevision?: number;
  };
  if (body.kind === "url" || body.url) {
    const result = addUrlResource(id, {
      name: body.name || body.url || "链接",
      url: body.url || "",
      note: body.note,
      baseRevision: body.baseRevision,
    });
    if (!result.ok) {
      const status = result.code === "resource_conflict" ? 409 : 400;
      return Response.json({ error: result.message, code: result.code }, { status });
    }
    return Response.json(result, { status: 201 });
  }
  return Response.json({ error: "请提供 url 或 multipart file" }, { status: 400 });
}
