// Spec: 017-site-tabs — 站内标签页持久化 API
// GET  ?module=X    → 该模块 { settings, tabs, history }
// POST action=save      body { module, site, tabs }      → 替换站点组标签
// POST action=history   body { module, site, entries }   → 追加历史并裁剪
// POST action=settings  body { module, maxTabs, maxHistory } → upsert 设置

import { NextResponse } from "next/server";
import {
  appendHistory,
  getSettings,
  loadModule,
  saveTabs,
  setSettings,
  trimTabs,
  type SiteSettings,
  type SiteTabRow,
  type SiteHistoryRow,
} from "@/infrastructure/site-tabs-repository";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const moduleKey = new URL(req.url).searchParams.get("module");
  if (!moduleKey) {
    return NextResponse.json({ error: "缺少 module 参数" }, { status: 400 });
  }
  try {
    const settings = getSettings(moduleKey);
    const { tabs, history } = loadModule(moduleKey);
    return NextResponse.json({ settings, tabs, history });
  } catch {
    return NextResponse.json({ error: "读取站点标签数据失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const moduleKey = typeof body.module === "string" ? body.module : "";
  if (!moduleKey) {
    return NextResponse.json({ error: "缺少 module" }, { status: 400 });
  }
  try {
    const action = body.action;
    if (action === "save") {
      const site = typeof body.site === "string" ? body.site : "";
      if (!site) return NextResponse.json({ error: "缺少 site" }, { status: 400 });
      const tabs = Array.isArray(body.tabs)
        ? (body.tabs as SiteTabRow[]).filter(
            (t): t is SiteTabRow =>
              typeof t === "object" &&
              t !== null &&
              typeof t.id === "string" &&
              typeof t.url === "string",
          )
        : [];
      saveTabs(moduleKey, site, tabs);
      trimTabs(moduleKey, site); // 服务端权威上限兜底
      return NextResponse.json({ ok: true });
    }
    if (action === "history") {
      const site = typeof body.site === "string" ? body.site : "";
      const entries = Array.isArray(body.entries)
        ? (body.entries as SiteHistoryRow[]).filter(
            (e): e is SiteHistoryRow =>
              typeof e === "object" && e !== null && typeof e.url === "string",
          )
        : [];
      appendHistory(moduleKey, site, entries);
      return NextResponse.json({ ok: true });
    }
    if (action === "settings") {
      const maxTabs = Number(body.maxTabs);
      const maxHistory = Number(body.maxHistory);
      const st: SiteSettings = {
        maxTabs: Number.isInteger(maxTabs) ? maxTabs : 10,
        maxHistory: Number.isInteger(maxHistory) ? maxHistory : 100,
      };
      setSettings(moduleKey, st);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "未知 action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "写入站点标签数据失败" }, { status: 500 });
  }
}
