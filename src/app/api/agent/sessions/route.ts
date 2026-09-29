import { createSession, listSessions } from "@/infrastructure/agent-session-store";

// 会话列表 + 新建
export async function GET() {
  return Response.json({ sessions: listSessions() });
}

export async function POST() {
  const meta = createSession();
  return Response.json({ session: meta });
}
