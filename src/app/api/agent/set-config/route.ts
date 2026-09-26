// 本地 Agent: 会话配置项 (POST {configId, value}) — mode/model/thought_level/sandbox
// → 返回最新连接状态 (含刷新后的 sessionConfig)
import { setConfigOption } from "@/infrastructure/workbuddy-acp";

export async function POST(req: Request) {
  let configId = "";
  let value = "";
  try {
    const body = (await req.json()) as { configId?: string; value?: string };
    configId = (body.configId ?? "").trim();
    value = (body.value ?? "").trim();
  } catch {
    // 空 body
  }
  if (!configId || !value) {
    return Response.json({ ok: false, error: "configId/value 不能为空" }, { status: 400 });
  }
  try {
    const st = await setConfigOption(configId, value);
    return Response.json({ ok: true, status: st });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
