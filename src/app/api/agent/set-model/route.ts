// 本地 Agent: 切换会话模型 (POST {model, localSessionId?}) → 返回最新连接状态
// 模型偏好在 setModel 内写入全局 agent-preference, 所有逻辑会话共享
import { setModel } from "@/infrastructure/workbuddy-acp";

export async function POST(req: Request) {
  let model = "";
  let localSessionId: string | undefined;
  try {
    const body = (await req.json()) as { model?: string; localSessionId?: string };
    model = (body.model ?? "").trim();
    localSessionId = body.localSessionId;
  } catch {
    // 空 body
  }
  if (!model) return Response.json({ ok: false, error: "model 为空" }, { status: 400 });
  try {
    const st = await setModel(model, localSessionId);
    return Response.json({ ok: true, status: st });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
