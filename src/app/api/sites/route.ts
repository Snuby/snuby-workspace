// Site (站点) 配置 API: 某主题下站点的列表/添加/移除/重排
// 语义: Site = 主题内的选项卡 (原"模块内站点组"); 站内标签页数据仍走 /api/site-tabs。

import { NextResponse } from "next/server";
import {
  addSite,
  listSites,
  removeSite,
  reorderSites,
  type SiteRow,
} from "@/infrastructure/site-tabs-repository";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const topicId = new URL(req.url).searchParams.get("topic");
  if (!topicId) {
    return NextResponse.json({ error: "缺少 topic 参数" }, { status: 400 });
  }
  try {
    const sites: SiteRow[] = listSites(topicId);
    return NextResponse.json({ sites });
  } catch {
    return NextResponse.json({ error: "读取站点失败" }, { status: 500 });
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
    if (action === "add") {
      const topicId = typeof body.topicId === "string" ? body.topicId : "";
      const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : "";
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!topicId || !url) return NextResponse.json({ error: "缺少 topicId 或 url" }, { status: 400 });
      const id = addSite(topicId, url, label);
      return NextResponse.json({ ok: true, id });
    }
    if (action === "remove") {
      const topicId = typeof body.topicId === "string" ? body.topicId : "";
      const siteId = typeof body.siteId === "string" ? body.siteId : "";
      if (!topicId || !siteId) return NextResponse.json({ error: "缺少 topicId 或 siteId" }, { status: 400 });
      removeSite(topicId, siteId);
      return NextResponse.json({ ok: true });
    }
    if (action === "reorder") {
      const topicId = typeof body.topicId === "string" ? body.topicId : "";
      const orderedIds = Array.isArray(body.orderedIds)
        ? body.orderedIds.filter((v): v is string => typeof v === "string")
        : [];
      if (!topicId || orderedIds.length === 0)
        return NextResponse.json({ error: "缺少 topicId 或 orderedIds" }, { status: 400 });
      reorderSites(topicId, orderedIds);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "未知 action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "写入站点失败" }, { status: 500 });
  }
}
