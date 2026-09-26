// 本地 Agent: 流式任务 (POST) — 转发 WorkBuddy 网关 SSE 为 NDJSON 行
// 每行: {type:"chunk"|"thought"|"tool"|"done"|"error", ...}; 前端按行流式渲染
import { prompt } from "@/infrastructure/workbuddy-acp";

export async function POST(req: Request) {
  let text = "";
  let timeoutMs = 300_000;
  try {
    const body = (await req.json()) as { text?: string; timeoutMs?: number };
    text = (body.text ?? "").trim();
    if (typeof body.timeoutMs === "number" && body.timeoutMs > 0) timeoutMs = body.timeoutMs;
  } catch {
    // 空 body
  }
  if (!text) {
    return Response.json({ ok: false, error: "任务内容为空" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // 客户端断开
        }
      };
      try {
        await prompt(
          text,
          (e) => push(e),
          { timeoutMs },
        );
      } catch (e) {
        push({ type: "error", error: (e as Error).message });
      } finally {
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
