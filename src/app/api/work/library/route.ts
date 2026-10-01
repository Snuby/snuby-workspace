import {
  createLibraryFolder,
  deleteLibraryFolder,
  moveWorkToFolder,
  readLibrary,
  renameLibraryFolder,
  renameWork,
  repairLibrary,
} from "@/infrastructure/agent-work";

export async function GET() {
  const library = repairLibrary();
  return Response.json({ library });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: string;
      name?: string;
      title?: string;
      parentId?: string | null;
      workId?: string;
      folderId?: string | null;
    };
    if (body.action === "createFolder") {
      const folder = createLibraryFolder(body.name || "未命名文件夹", body.parentId ?? null);
      return Response.json({ folder, library: readLibrary() }, { status: 201 });
    }
    if (body.action === "renameFolder") {
      if (!body.folderId) return Response.json({ error: "folderId 必填" }, { status: 400 });
      const folder = renameLibraryFolder(body.folderId, body.name || "");
      return Response.json({ folder, library: readLibrary() });
    }
    if (body.action === "deleteFolder") {
      if (!body.folderId) return Response.json({ error: "folderId 必填" }, { status: 400 });
      deleteLibraryFolder(body.folderId);
      return Response.json({ library: readLibrary() });
    }
    if (body.action === "renameWork") {
      if (!body.workId) return Response.json({ error: "workId 必填" }, { status: 400 });
      const work = renameWork(body.workId, body.title || body.name || "");
      return Response.json({ work, library: readLibrary() });
    }
    if (body.action === "moveWork") {
      if (!body.workId) return Response.json({ error: "workId 必填" }, { status: 400 });
      moveWorkToFolder(body.workId, body.folderId ?? null);
      return Response.json({ library: readLibrary() });
    }
    return Response.json({ error: "未知 action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
