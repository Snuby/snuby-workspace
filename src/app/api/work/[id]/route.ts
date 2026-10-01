// 单个作品：读 / 改 / 删（spec 018）
import {
  deleteWork,
  getWork,
  writeWorkMeta,
  type WorkStatus,
} from "@/infrastructure/agent-work";
import { formatTaskKey } from "@/infrastructure/agent-runtime";
import { isLocalSessionBusy } from "@/infrastructure/workbuddy-acp";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const work = getWork(id);
  if (!work) return Response.json({ error: "作品不存在" }, { status: 404 });
  return Response.json({ work });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const work = getWork(id);
  if (!work) return Response.json({ error: "作品不存在" }, { status: 404 });
  try {
    const body = (await req.json()) as {
      title?: string;
      status?: WorkStatus;
    };
    if (typeof body.title === "string" && body.title.trim()) {
      work.title = body.title.trim();
    }
    if (body.status) work.status = body.status;
    writeWorkMeta(work);
    return Response.json({ work });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const work = getWork(id);
  if (!work) return Response.json({ error: "作品不存在" }, { status: 404 });

  // 过渡：busy 检查暂用裸 id 队列键；W3 起统一 TaskKey
  const taskKey = formatTaskKey("work", id);
  if (isLocalSessionBusy(taskKey) || isLocalSessionBusy(id)) {
    return Response.json(
      { error: "作品任务进行中或排队中，请先停止后再删除", code: "work_busy" },
      { status: 409 },
    );
  }

  const ok = deleteWork(id);
  if (!ok) return Response.json({ error: "删除失败" }, { status: 500 });
  return Response.json({ ok: true });
}
