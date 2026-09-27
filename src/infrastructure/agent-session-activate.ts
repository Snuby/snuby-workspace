// 本地会话 → 网关会话 激活 + 工作约定注入 (activate 路由与 prompt 首轮共用)
import crypto from "node:crypto";
import path from "node:path";
import {
  getSession,
  getSystemPrompt,
  updateSessionGateway,
  workDirOf,
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

/** 激活本地会话对应的网关会话, 并在工作约定指纹变化或网关会话重建时注入「约定 + 历史记忆位置」。
 * 每个本地会话绑定唯一 ACP 连接 (key=localSessionId) + 唯一 cwd (会话工作区),
 * 避免网关侧按 cwd 复用会话导致上下文串扰; 多会话各自连接, 并行互不影响。
 * 网关会话重建 (load 失败新建/首次新建) 时强制重新注入: 新网关会话没有约定内容, 指纹一致也必须补上。
 * 工作区与内部数据物理分离: cwd/产物 → workspaces/<id>, 历史/元信息 → sessions/<id>。 */
export async function activateLocalSession(id: string): Promise<ActivatedSession> {
  const meta = getSession(id);
  if (!meta) throw new Error("会话不存在");
  const workDir = workDirOf(id);
  const cwd = meta.acpCwd ?? workDir;
  const sid = await ensureSessionFor(id, meta.acpSessionId, cwd);
  const sessionRecreated = sid !== meta.acpSessionId; // 网关会话重建 (load 失败新建 / 首次新建)
  updateSessionGateway(id, { acpSessionId: sid, acpCwd: cwd });

  // 工作约定注入: 指纹不匹配 或 网关会话重建 才注入
  // (约定未变且会话未重建不重复注入; 注入失败也记录指纹避免每次卡顿, 下次改约定或会话重建再触发)
  const sysPrompt = getSystemPrompt();
  const fp = crypto.createHash("sha1").update(sysPrompt).digest("hex").slice(0, 16);
  if (meta.sysPromptFp !== fp || sessionRecreated) {
    const dataDir = path.join(SESSIONS_ROOT, id);
    const text = buildSessionSetupText(sysPrompt, workDir, dataDir);
    const injected = await injectSessionSetup(id, sid, text);
    updateSessionGateway(id, { sysPromptFp: fp, sysPromptFailed: injected ? undefined : true });
  }
  return { acpSessionId: sid, sysPromptFp: fp };
}
