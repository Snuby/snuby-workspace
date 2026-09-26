import { appendMessage, readMessages } from "@/infrastructure/agent-session-store";

// 会话消息: 读取历史 / 追加一条
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json({ messages: readMessages(id) });
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
