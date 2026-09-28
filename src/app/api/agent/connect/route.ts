// 本地 Agent: 建立/重连连接 (POST) — 发现网关 + connect + initialize
// 重连会 reset 全部连接与排队, 返回 interruptedLocalIds 供前端标 interrupted (AC-8)
import { connect } from "@/infrastructure/workbuddy-acp";

export async function POST() {
  const st = await connect();
  if (st.phase === "connected") {
    return Response.json({
      ok: true,
      status: st,
      interruptedLocalIds: st.interruptedLocalIds ?? [],
    });
  }
  return Response.json(
    { ok: false, status: st, interruptedLocalIds: st.interruptedLocalIds ?? [] },
    { status: 502 },
  );
}
