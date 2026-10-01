// 作品列表 / 创建（spec 018）
import { createWork, listWorks, repairLibrary } from "@/infrastructure/agent-work";

export async function GET() {
  const library = repairLibrary();
  const works = listWorks();
  return Response.json({ works, library });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { title?: string; folderId?: string | null };
    const title = (body.title ?? "").trim();
    if (!title) {
      return Response.json({ error: "作品名称不能为空" }, { status: 400 });
    }
    const meta = createWork({ title, folderId: body.folderId ?? null });
    return Response.json({ work: meta }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
