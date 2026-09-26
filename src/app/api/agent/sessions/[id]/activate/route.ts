import crypto from "node:crypto";
import path from "node:path";
import {
  getSession,
  getSystemPrompt,
  updateSessionGateway,
  SESSIONS_ROOT,
} from "@/infrastructure/agent-session-store";
import {
  buildSessionSetupText,
  ensureSessionFor,
  injectSessionSetup,
  status as acpStatus,
} from "@/infrastructure/workbuddy-acp";

// 激活本地会话对应的网关会话 (session/load 恢复上下文 / session/new 新建并回写绑定)
// 首次激活或工作约定变更时, 向网关会话注入「工作约定 + 历史记忆位置」作为首条消息
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meta = getSession(id);
  if (!meta) return Response.json({ error: "会话不存在" }, { status: 404 });
  try {
    // 每个本地会话绑定唯一工作目录 (会话目录), 避免网关侧按 cwd 复用会话导致上下文串扰
    // (实测: 探测脚本与生产都默认 /tmp, WorkBuddy 持久化了含测试暗号的 /tmp 会话并被新会话加载)
    const cwd = meta.acpCwd ?? path.join(SESSIONS_ROOT, id);
    const sid = await ensureSessionFor(meta.acpSessionId, cwd);
    updateSessionGateway(id, { acpSessionId: sid, acpCwd: cwd });

    // 工作约定注入: 指纹不匹配才注入 (约定未变不重复注入)
    const sysPrompt = getSystemPrompt();
    const fp = crypto.createHash("sha1").update(sysPrompt).digest("hex").slice(0, 16);
    if (meta.sysPromptFp !== fp) {
      const sessionDir = path.join(SESSIONS_ROOT, id);
      const text = buildSessionSetupText(sysPrompt, sessionDir);
      const injected = await injectSessionSetup(sid, text);
      // 注入失败也记录指纹 (避免每次激活都重试卡顿); 用户编辑约定后指纹变化会重新注入
      updateSessionGateway(id, { sysPromptFp: fp, sysPromptFailed: injected ? undefined : true });
    }

    return Response.json({ acpSessionId: sid, sysPromptFp: fp, status: acpStatus() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
