// 本地 Agent: 流式任务 (POST) — 转发 WorkBuddy 网关 SSE 为 NDJSON 行
// 每行: {type:"queued"|"chunk"|"thought"|"tool"|"done"|"error", ...}; 前端按行流式渲染
// 激活+prompt 必须在同一全局锁内, 防止对齐后被他会话插队 (spec 017 §11)
import { globalQueueSnapshot, prompt, withGlobalAgentLock } from "@/infrastructure/workbuddy-acp";
import {
  getSession,
  listSessions,
  readMessages,
  updateSessionGateway,
} from "@/infrastructure/agent-session-store";
import { activateLocalSessionUnlocked } from "@/infrastructure/agent-session-activate";
import { snubyLog } from "@/infrastructure/snuby-log";

/** 「继续」类短指令: ACP 会话可能已空, 内联近期历史, 避免再诱导 Read messages.jsonl */
function looksLikeContinue(text: string): boolean {
  const t = text.trim();
  if (t.length > 40) return false;
  return /^(继续|接着|resume|continue)/i.test(t) || /继续(任务|刚才|上[一面]|工作)/.test(t);
}

function inlineRecentHistory(localSessionId: string): string {
  const { messages } = readMessages(localSessionId, { limit: 10 });
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.role === "user" ? "用户" : "助手";
    const body = (m.text ?? "").trim();
    if (!body) continue;
    const clipped = body.length > 600 ? `${body.slice(0, 600)}…` : body;
    lines.push(`${role}: ${clipped}`);
  }
  if (!lines.length) return "";
  return `【近期对话摘录 · 已内联，勿再读取任何日志文件】\n${lines.join("\n\n")}\n\n`;
}

export async function POST(req: Request) {
  let text = "";
  let timeoutMs = 300_000;
  let acpSessionId: string | undefined;
  let cwd: string | undefined;
  let localSessionId: string | undefined;
  try {
    const body = (await req.json()) as { text?: string; timeoutMs?: number; localSessionId?: string };
    text = (body.text ?? "").trim();
    if (typeof body.timeoutMs === "number" && body.timeoutMs > 0) timeoutMs = body.timeoutMs;
    localSessionId = body.localSessionId;
    if (localSessionId) {
      const meta = getSession(localSessionId);
      if (meta) {
        acpSessionId = meta.acpSessionId;
        cwd = meta.acpCwd;
        if (looksLikeContinue(text)) {
          const hist = inlineRecentHistory(localSessionId);
          if (hist) text = `${hist}请根据以上摘录继续推进用户当前要做的事。用户说：${text}`;
        }
      }
    }
  } catch {
    // 空 body
  }
  if (!text) {
    return Response.json({ ok: false, error: "任务内容为空" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // 客户端断开
        }
      };
      try {
        const titleOf = (id: string | null) => {
          if (!id || id === "default") return id;
          return listSessions().find((s) => s.id === id)?.title ?? id.slice(0, 8);
        };

        let clientGone = false;
        const safePush = (obj: unknown) => {
          try {
            push(obj);
          } catch {
            clientGone = true;
          }
        };

        const lockKey = localSessionId ?? "default";
        // 先入队 (同步写入 pendingTokens), 再推排队快照, 最后 await 执行
        const run = withGlobalAgentLock(lockKey, async () => {
          safePush({ type: "running" });
          let promptText = text;
          let pendingFp: string | undefined;
          if (localSessionId) {
            // deferInject: 全量约定并入本轮; 否则至少附带短工作区提醒 (防临时 cwd)
            const act = await activateLocalSessionUnlocked(localSessionId, { deferInject: true });
            acpSessionId = act.acpSessionId;
            const meta = getSession(localSessionId);
            cwd = meta?.acpCwd ?? act.workDir ?? cwd;
            if (act.setupText) {
              promptText = `${act.setupText}\n\n——\n用户本轮请求：\n${text}`;
              pendingFp = act.sysPromptFp;
              snubyLog(
                "session",
                `inject merged into prompt local=${localSessionId} acp=${act.acpSessionId} setupLen=${act.setupText.length} userLen=${text.length} totalLen=${promptText.length}`,
              );
            } else if (act.reminderText) {
              promptText = `${act.reminderText}\n\n——\n用户本轮请求：\n${text}`;
              snubyLog(
                "session",
                `inject reminder into prompt local=${localSessionId} acp=${act.acpSessionId} reminderLen=${act.reminderText.length} userLen=${text.length}`,
              );
            } else {
              snubyLog(
                "session",
                `inject none into prompt local=${localSessionId} acp=${act.acpSessionId} (unexpected: no setup/reminder)`,
              );
            }
          } else {
            snubyLog("session", `inject bypass local=default (no localSessionId)`);
          }
          try {
            await prompt(
              promptText,
              (e) => {
                if (clientGone) return;
                safePush(e);
                // 生产构建会 gzip。权限/结束这种短行会攒到流关闭才到达浏览器,
                // 界面就只看见「正在执行」或弹窗和结束挤在同一帧。补填充迫使立即刷出。
                if (e.type === "permission" || e.type === "done") {
                  try {
                    controller.enqueue(encoder.encode(`${" ".repeat(20 * 1024)}\n`));
                  } catch {
                    clientGone = true;
                  }
                }
              },
              {
                timeoutMs,
                acpSessionId,
                cwd,
                localSessionId,
                bypassGlobalQueue: true,
                onTimeout: () => {
                  safePush({ type: "error", error: "任务超时（网关任务可能仍在执行）" });
                },
              },
            );
            if (localSessionId && pendingFp) {
              updateSessionGateway(localSessionId, { sysPromptFp: pendingFp, sysPromptFailed: undefined });
              snubyLog(
                "session",
                `inject commit ok local=${localSessionId} fp=${pendingFp}`,
              );
            }
          } catch (e) {
            if (localSessionId && pendingFp) {
              updateSessionGateway(localSessionId, { sysPromptFailed: true });
              snubyLog(
                "session",
                `inject commit fail local=${localSessionId}: ${(e as Error).message}`,
              );
            }
            throw e;
          }
        });
        const q = globalQueueSnapshot();
        // AC-10: 前序 = 当前持锁会话 (若不是自己)
        const aheadKey = q.activeKey && q.activeKey !== lockKey ? q.activeKey : null;
        push({
          type: "queued",
          activeKey: q.activeKey,
          activeTitle: titleOf(aheadKey ?? q.activeKey),
          aheadKey,
          aheadTitle: titleOf(aheadKey),
          pendingKeys: q.pendingKeys,
        });
        await run;
      } catch (e) {
        push({ type: "error", error: (e as Error).message });
      } finally {
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
