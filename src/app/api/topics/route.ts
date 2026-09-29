// Topic (主题) 配置 API: 列表/创建/重命名/删除/设置
// 语义: Topic = 灵活工作台的一级板块 (原"模块"), 站点配置在 /api/sites。

import { NextResponse } from "next/server";
import {
  createTopic,
  deleteTopic,
  listTopics,
  renameTopic,
  updateTopicSettings,
  type TopicRow,
} from "@/infrastructure/site-tabs-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const topics: TopicRow[] = listTopics();
    return NextResponse.json({ topics });
  } catch {
    return NextResponse.json({ error: "读取主题失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  try {
    const action = body.action;
    if (action === "create") {
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "缺少主题名称" }, { status: 400 });
      const id = createTopic(name);
      return NextResponse.json({ ok: true, id });
    }
    if (action === "rename") {
      const id = typeof body.id === "string" ? body.id : "";
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
      if (!id || !name) return NextResponse.json({ error: "缺少 id 或名称" }, { status: 400 });
      renameTopic(id, name);
      return NextResponse.json({ ok: true });
    }
    if (action === "delete") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
      deleteTopic(id);
      return NextResponse.json({ ok: true });
    }
    if (action === "settings") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
      const settings =
        body.settings && typeof body.settings === "object"
          ? (body.settings as Record<string, unknown>)
          : null;
      updateTopicSettings(id, settings);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "未知 action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "写入主题失败" }, { status: 500 });
  }
}
