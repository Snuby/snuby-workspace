import {
  activateLocalSession,
} from "@/infrastructure/agent-session-activate";
import {
  status as acpStatus,
} from "@/infrastructure/workbuddy-acp";

// 激活本地会话对应的网关会话 (session/load 恢复上下文 / session/new 新建并回写绑定)
// 首次激活或工作约定变更时, 向网关会话注入「工作约定 + 历史记忆位置」作为首条消息
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const r = await activateLocalSession(id);
    return Response.json({
      acpSessionId: r.acpSessionId,
      sysPromptFp: r.sysPromptFp,
      status: acpStatus(),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
