// 本地 Agent: 建立连接 (POST) — 发现网关 + connect + initialize
import { connect } from "@/infrastructure/workbuddy-acp";

export async function POST() {
  const st = await connect();
  if (st.phase === "connected") {
    return Response.json({ ok: true, status: st });
  }
  return Response.json({ ok: false, status: st }, { status: 502 });
}
