// 本地 Agent: 切换会话模型 (POST {model}) → 返回最新连接状态
import { setModel } from "@/infrastructure/workbuddy-acp";

export async function POST(req: Request) {
  let model = "";
  try {
    const body = (await req.json()) as { model?: string };
    model = (body.model ?? "").trim();
  } catch {
    // 空 body
  }
  if (!model) return Response.json({ ok: false, error: "model 为空" }, { status: 400 });
  try {
    const st = await setModel(model);
    return Response.json({ ok: true, status: st });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
