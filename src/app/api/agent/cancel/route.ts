// 本地 Agent: 取消指定会话任务 (POST); 按 localSessionId 定位其专属连接上的网关会话
import { cancel } from "@/infrastructure/workbuddy-acp";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { localSessionId?: string };
  await cancel(body.localSessionId);
  return Response.json({ ok: true });
}
