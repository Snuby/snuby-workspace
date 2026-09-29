// 本地 Agent: 越界写入审计 (POST {id, cutoffMs?, sinceMs?})
// 软隔离兜底: WorkBuddy 若把产物写到了本会话工作区之外 (兄弟会话 artifacts 等),
// 此处能发现, 用于在 UI 上提示会话隔离失效风险。
import { auditWorkspaceViolations } from "@/infrastructure/agent-session-store";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    cutoffMs?: number;
    sinceMs?: number;
  };
  if (!body.id) return Response.json({ ok: false, error: "缺少会话 id" }, { status: 400 });
  try {
    const violations = auditWorkspaceViolations(body.id, {
      cutoffMs: body.cutoffMs,
      sinceMs: body.sinceMs,
    });
    return Response.json({ ok: true, violations });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
