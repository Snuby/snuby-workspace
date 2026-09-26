import { getSession, updateSessionGateway } from "@/infrastructure/agent-session-store";
import { ensureSessionFor, status as acpStatus } from "@/infrastructure/workbuddy-acp";

// 激活本地会话对应的网关会话 (session/load 恢复上下文 / session/new 新建并回写绑定)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meta = getSession(id);
  if (!meta) return Response.json({ error: "会话不存在" }, { status: 404 });
  try {
    const sid = await ensureSessionFor(meta.acpSessionId, meta.acpCwd);
    updateSessionGateway(id, { acpSessionId: sid });
    return Response.json({ acpSessionId: sid, status: acpStatus() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
