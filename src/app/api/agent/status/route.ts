// 本地 Agent: 连接状态 (GET) — 前端轮询做连接可视化
// ?sid=<localSessionId>: 返回该会话专属连接的网关态 (模型/配置/用量/连接 ID)
// 无 sid: 返回全局发现态 (网关进程/端口/心跳)
import { status } from "@/infrastructure/workbuddy-acp";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const sid = u.searchParams.get("sid") ?? undefined;
  return Response.json({ ok: true, status: status(sid) });
}
