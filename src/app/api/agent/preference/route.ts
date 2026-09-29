// 本地 Agent 全局偏好: 不活跃超时等 (与模型/mode 同文件 agent-preference.json)
import {
  getAgentPreference,
  getInactivityTimeoutMs,
  patchAgentPreference,
  DEFAULT_INACTIVITY_TIMEOUT_MS,
  INACTIVITY_TIMEOUT_MAX_MS,
  INACTIVITY_TIMEOUT_MIN_MS,
} from "@/infrastructure/agent-session-store";

export async function GET() {
  const pref = getAgentPreference();
  return Response.json({
    inactivityTimeoutMs: getInactivityTimeoutMs(),
    defaults: {
      inactivityTimeoutMs: DEFAULT_INACTIVITY_TIMEOUT_MS,
      minMs: INACTIVITY_TIMEOUT_MIN_MS,
      maxMs: INACTIVITY_TIMEOUT_MAX_MS,
    },
    preference: pref,
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { inactivityTimeoutMs?: number };
  if (body.inactivityTimeoutMs === undefined) {
    return Response.json({ error: "无更新字段" }, { status: 400 });
  }
  const next = patchAgentPreference({ inactivityTimeoutMs: body.inactivityTimeoutMs });
  return Response.json({
    ok: true,
    inactivityTimeoutMs: getInactivityTimeoutMs(),
    preference: next,
  });
}
