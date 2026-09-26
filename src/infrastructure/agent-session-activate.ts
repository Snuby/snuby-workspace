// 本地会话 → 网关会话 激活 + 工作约定注入 (activate 路由与 prompt 首轮共用)
import crypto from "node:crypto";
import path from "node:path";
import {
  getSession,
  getSystemPrompt,
  updateSessionGateway,
  SESSIONS_ROOT,
} from "./agent-session-store";
import {
  buildSessionSetupText,
  ensureSessionFor,
  injectSessionSetup,
} from "./workbuddy-acp";

export interface ActivatedSession {
  acpSessionId: string;
  sysPromptFp: string;
}

/** 激活本地会话对应的网关会话, 并在工作约定指纹变化时注入「约定 + 历史记忆位置」。
 * 每个本地会话绑定唯一 cwd (会话目录), 避免网关侧按 cwd 复用会话导致上下文串扰。 */
export async function activateLocalSession(id: string): Promise<ActivatedSession> {
  const meta = getSession(id);
  if (!meta) throw new Error("会话不存在");
  const cwd = meta.acpCwd ?? path.join(SESSIONS_ROOT, id);
  const sid = await ensureSessionFor(meta.acpSessionId, cwd);
  updateSessionGateway(id, { acpSessionId: sid, acpCwd: cwd });

  // 工作约定注入: 指纹不匹配才注入 (约定未变不重复注入; 注入失败也记录指纹避免每次卡顿)
  const sysPrompt = getSystemPrompt();
  const fp = crypto.createHash("sha1").update(sysPrompt).digest("hex").slice(0, 16);
  if (meta.sysPromptFp !== fp) {
    const sessionDir = path.join(SESSIONS_ROOT, id);
    const text = buildSessionSetupText(sysPrompt, sessionDir);
    const injected = await injectSessionSetup(sid, text);
    updateSessionGateway(id, { sysPromptFp: fp, sysPromptFailed: injected ? undefined : true });
  }
  return { acpSessionId: sid, sysPromptFp: fp };
}
