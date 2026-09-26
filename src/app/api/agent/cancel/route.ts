// 本地 Agent: 取消当前任务 (POST)
import { cancel } from "@/infrastructure/workbuddy-acp";

export async function POST() {
  await cancel();
  return Response.json({ ok: true });
}
