// 本地 Agent: 工具权限
// GET  ?localSessionId=  → 轮询未决权限 (NDJSON 阻塞时的可靠通道)
// POST { localSessionId, requestId, optionId? / cancelled? } → 应答网关
import { listPendingPermissions, respondPermission } from "@/infrastructure/workbuddy-acp";

export async function GET(req: Request) {
  const sid = new URL(req.url).searchParams.get("localSessionId")?.trim() ?? "";
  if (!sid) {
    return Response.json({ ok: false, error: "localSessionId 不能为空" }, { status: 400 });
  }
  return Response.json({ ok: true, pending: listPendingPermissions(sid) });
}

export async function POST(req: Request) {
  let localSessionId = "";
  let requestId: string | number | undefined;
  let optionId: string | undefined;
  let cancelled = false;
  try {
    const body = (await req.json()) as {
      localSessionId?: string;
      requestId?: string | number;
      optionId?: string;
      cancelled?: boolean;
    };
    localSessionId = (body.localSessionId ?? "").trim();
    requestId = body.requestId;
    optionId = typeof body.optionId === "string" ? body.optionId.trim() : undefined;
    cancelled = body.cancelled === true || !optionId;
  } catch {
    // 空 body
  }
  if (!localSessionId || requestId === undefined || requestId === null || requestId === "") {
    return Response.json({ ok: false, error: "localSessionId/requestId 不能为空" }, { status: 400 });
  }
  const decision = cancelled || !optionId
    ? ({ outcome: "cancelled" } as const)
    : ({ outcome: "selected", optionId } as const);
  const ok = await respondPermission(localSessionId, requestId, decision);
  if (!ok) {
    return Response.json({ ok: false, error: "权限请求已过期或不存在" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
