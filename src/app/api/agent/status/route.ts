// 本地 Agent: 连接状态 (GET) — 前端轮询做连接可视化
import { status } from "@/infrastructure/workbuddy-acp";

export async function GET() {
  return Response.json({ ok: true, status: status() });
}
