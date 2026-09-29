import { appendMessage, readMessages } from "@/infrastructure/agent-session-store";

// 会话消息: 分页读取(渐进加载) / 追加一条
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(Number(limitRaw) || 50, 500)) : undefined;
  const cursorRaw = url.searchParams.get("cursor");
  const cursor = cursorRaw !== null && cursorRaw !== "" ? Number(cursorRaw) : undefined;
  return Response.json(readMessages(id, { limit, cursor }));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !body.role || typeof body.text !== "string") {
    return Response.json({ error: "消息格式错误" }, { status: 400 });
  }
  appendMessage(id, body);
  return Response.json({ ok: true });
}
