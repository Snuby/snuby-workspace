// 本地会话 → 网关会话 激活 + 工作约定注入 (activate 路由与 prompt 首轮共用)
//
// 逻辑上下文注入场景 (必须覆盖):
// 1. 新建会话首条发送 → session/new → 全量注入 (约定+工作区+历史+产物)
// 2. 同会话连续发送 → 跳过全量; 仍附带短工作区提醒 (防模型迷信进程 cwd)
// 3. A→B→A 切换后再发送 → 即使 session/load 成功且 fp 未变, 也全量重注入
//    (实测: load 后 inject skip → Agent 落到 WorkBuddy 临时目录, 找不到产物)
// 4. 重连 / clearAllGatewayBindings → 绑定清空 → session/new → 全量注入
// 5. load 失败重建 → recreated → 全量注入
// 6. 工作约定变更 → sysPromptFp 变化 → 全量注入
// 7. 上次注入失败 → sysPromptFailed → 全量重试
// 8. set-model/set-config 对齐他会话后回来 → active 漂移 → load + 切换检测 → 全量注入
// 9. 显式 activate 路由 → standalone 单独注入轮
// 10. deferInject 合并进用户消息失败 → 标 sysPromptFailed, 下次重试
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  getSession,
  getSystemPrompt,
  listArtifacts,
  readMessages,
  updateSessionGateway,
  workDirOf,
} from "./agent-session-store";
import {
  alignLocalSession,
  buildSessionSetupText,
  buildWorkDirReminder,
  injectSessionSetup,
  markLogicalSessionAligned,
  peekLogicalSessionMarker,
  withGlobalAgentLock,
} from "./workbuddy-acp";
import { snubyLog } from "./snuby-log";

export interface ActivatedSession {
  acpSessionId: string;
  sysPromptFp: string;
  reinjected: boolean;
  /**
   * 发送路径 (deferInject): 约定正文由调用方拼进用户首条 prompt, 避免单独一轮注入
   * (单独注入会多耗一次模型调用, 且触发 WorkBuddy「生成会话标题」)。
   */
  setupText?: string;
  /**
   * 未做全量注入时, 仍应拼进本轮 prompt 的短工作区提醒
   * (进程 cwd 恒为 WorkBuddy 临时目录, 模型极易忘掉绝对工作区)。
   */
  reminderText?: string;
  workDir: string;
}

/** 摘录近期对话给重建后的网关会话 (内联文本, 避免 Agent Read messages.jsonl) */
function recentHistorySnippet(id: string, limit = 24): string {
  const { messages } = readMessages(id, { limit });
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.role === "user" ? "用户" : "助手";
    const text = (m.text ?? "").trim();
    if (!text) continue;
    const clipped = text.length > 900 ? `${text.slice(0, 900)}…` : text;
    lines.push(`${role}: ${clipped}`);
  }
  return lines.join("\n\n");
}

export type ActivateOpts = {
  /**
   * true: 不单独 prompt 注入, 返回 setupText 供调用方并入用户消息。
   * false/缺省: 立即单独注入一轮 (显式 activate 路由)。
   */
  deferInject?: boolean;
};

/** 激活本体 (不加全局锁)。调用方须已持 withGlobalAgentLock, 或接受与他会话竞态。
 * 会话目录即工作区: cwd/产物 → sessions/<id>/artifacts, 历史/元信息 → sessions/<id>/{meta,messages}。
 * 网关会话重建或逻辑会话切换时强制重新注入工作约定、工作区、近期历史与产物清单。 */
export async function activateLocalSessionUnlocked(
  id: string,
  opts: ActivateOpts = {},
): Promise<ActivatedSession> {
  const meta = getSession(id);
  if (!meta) throw new Error("会话不存在");
  const workDir = workDirOf(id);
  mkdirSync(`${workDir}/artifacts`, { recursive: true });
  // 始终以 sessions/<id> 为准; 网关 cwd 参数本身无效, 但仍传入便于日志对齐
  const prevSid = meta.acpSessionId;
  const sid = await alignLocalSession(id, prevSid, workDir);
  const sessionRecreated = !prevSid || sid !== prevSid;
  updateSessionGateway(id, { acpSessionId: sid, acpCwd: workDir });

  const sysPrompt = getSystemPrompt();
  const fp = crypto.createHash("sha1").update(sysPrompt).digest("hex").slice(0, 16);
  const prevLogical = peekLogicalSessionMarker();
  // 切换逻辑会话: 即使 load 成功且约定指纹未变, 也必须重注入
  const switchedLogical = prevLogical !== null && prevLogical !== id;
  const fpMismatch = meta.sysPromptFp !== fp;
  const prevFailed = !!meta.sysPromptFailed;
  const needInject = sessionRecreated || fpMismatch || prevFailed || switchedLogical;
  // 排障: 一眼看出为何注入/跳过 (对应设计场景 1–10)
  const reasons = [
    sessionRecreated ? "recreated" : null,
    switchedLogical ? "switched" : null,
    fpMismatch ? "fpMismatch" : null,
    prevFailed ? "prevFailed" : null,
  ]
    .filter(Boolean)
    .join(",") || "none";
  const artifacts = listArtifacts(id);
  let reinjected = false;
  let setupText: string | undefined;
  let reminderText: string | undefined;

  if (needInject) {
    // 重建或切换都带历史, 避免「只记得约定、不记得刚聊过什么/有哪些产物」
    const recent = sessionRecreated || switchedLogical ? recentHistorySnippet(id) : "";
    const mode = opts.deferInject ? "prefix" : "standalone";
    const text = buildSessionSetupText(sysPrompt, workDir, {
      recentHistory: recent || undefined,
      artifacts,
      sessionId: id,
      mode,
    });
    snubyLog(
      "session",
      `inject prepare local=${id} acp=${sid} reasons=${reasons} defer=${!!opts.deferInject} mode=${mode} histChars=${recent.length} artifacts=${artifacts.length} setupLen=${text.length} prevLogical=${prevLogical ?? "-"} prevSid=${prevSid ? prevSid.slice(0, 8) : "-"} fp=${fp}`,
    );
    if (opts.deferInject) {
      setupText = text;
      reinjected = true;
      // 先占位: prompt 失败会标 sysPromptFailed, 下次仍会 needInject
      markLogicalSessionAligned(id);
      snubyLog("session", `inject defer-armed local=${id} acp=${sid} (await prompt commit)`);
    } else {
      const injected = await injectSessionSetup(id, sid, text, { bypassGlobalQueue: true });
      reinjected = injected;
      updateSessionGateway(id, { sysPromptFp: fp, sysPromptFailed: injected ? undefined : true });
      if (injected) markLogicalSessionAligned(id);
      snubyLog("session", `inject done local=${id} acp=${sid} ok=${injected} standalone=1`);
    }
  } else {
    reminderText = buildWorkDirReminder(workDir, artifacts);
    snubyLog(
      "session",
      `inject skip local=${id} acp=${sid} reasons=same-session fp=${fp} reminderLen=${reminderText.length} artifacts=${artifacts.length} prevLogical=${prevLogical ?? "-"}`,
    );
  }
  return {
    acpSessionId: sid,
    sysPromptFp: fp,
    reinjected,
    setupText,
    reminderText,
    workDir,
  };
}

/** 显式激活 (activate 路由): 整段占全局锁。发送路径请用 unlocked + 与 prompt 同锁。 */
export async function activateLocalSession(id: string): Promise<ActivatedSession> {
  return withGlobalAgentLock(id, () => activateLocalSessionUnlocked(id));
}
