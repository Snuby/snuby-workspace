import { getSystemPrompt, setSystemPrompt } from "@/infrastructure/agent-session-store";

// 工作约定: 查看/编辑全局系统提示词 (对所有本地会话生效)
export async function GET() {
  return Response.json({ prompt: getSystemPrompt() });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { prompt?: string };
  const text = (body.prompt ?? "").trim();
  if (!text) return Response.json({ error: "约定内容为空" }, { status: 400 });
  setSystemPrompt(text);
  return Response.json({ ok: true });
}
