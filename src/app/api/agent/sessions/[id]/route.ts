import { deleteSession, renameSession } from "@/infrastructure/agent-session-store";
import { isLocalSessionBusy } from "@/infrastructure/workbuddy-acp";

// 单个会话: 重命名 / 删除
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const meta = renameSession(id, body.title ?? "");
  if (!meta) return Response.json({ error: "会话不存在" }, { status: 404 });
  return Response.json({ session: meta });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // AC-9: running / queued / draining 不可删
  if (isLocalSessionBusy(id)) {
    return Response.json(
      { error: "会话任务进行中或排队中，请先停止/取消后再删除" },
      { status: 409 },
    );
  }
  const ok = deleteSession(id);
  if (!ok) return Response.json({ error: "会话不存在" }, { status: 404 });
  return Response.json({ ok: true });
}
