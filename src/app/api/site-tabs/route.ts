// Spec: 017-site-tabs — 站内标签页持久化 API
// GET  ?limits=1     → 全局 { maxTabs, maxHistory }
// GET  ?module=X     → 该模块 { settings, tabs, history }
// POST action=global-limits body { maxTabs, maxHistory } → 全局上限
// POST action=save      body { module, site, tabs }      → 替换站点组标签
// POST action=history   body { module, site, entries }   → 追加历史并裁剪
// POST action=settings  body { module, … } → upsert 模块设置（上限走全局）

import { NextResponse } from "next/server";
import {
  appendHistory,
  getGlobalTabLimits,
  getSettings,
  loadModule,
  saveTabs,
  setGlobalTabLimits,
  setSettings,
  trimTabs,
  type SiteSettings,
  type SiteTabRow,
  type SiteHistoryRow,
} from "@/infrastructure/site-tabs-repository";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  if (sp.get("limits") === "1") {
    try {
      return NextResponse.json(getGlobalTabLimits());
    } catch {
      return NextResponse.json({ error: "读取全局标签上限失败" }, { status: 500 });
    }
  }
  const moduleKey = sp.get("module");
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
  const action = body.action;
  try {
    if (action === "global-limits") {
      const maxTabs = Number(body.maxTabs);
      const maxHistory = Number(body.maxHistory);
      const limits = setGlobalTabLimits(
        Number.isFinite(maxTabs) ? maxTabs : 10,
        Number.isFinite(maxHistory) ? maxHistory : 100,
      );
      return NextResponse.json({ ok: true, ...limits });
    }

    const moduleKey = typeof body.module === "string" ? body.module : "";
    if (!moduleKey) {
      return NextResponse.json({ error: "缺少 module" }, { status: 400 });
    }
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
      const limits = getGlobalTabLimits();
      const activeSite = typeof body.activeSite === "string" && body.activeSite ? body.activeSite : null;
      const webviewMinKeep = Number(body.webviewMinKeep);
      const webviewRetentionHours = Number(body.webviewRetentionHours);
      const homeUrl =
        typeof body.homeUrl === "string"
          ? body.homeUrl.trim() || null
          : body.homeUrl === null
            ? null
            : undefined;
      const st: SiteSettings = {
        maxTabs: limits.maxTabs,
        maxHistory: limits.maxHistory,
        activeSite,
        // 未显式传入的字段保持 undefined → repository 保留库内旧值
        ...(Number.isInteger(webviewMinKeep) ? { webviewMinKeep } : {}),
        ...(Number.isInteger(webviewRetentionHours) ? { webviewRetentionHours } : {}),
        ...(homeUrl !== undefined ? { homeUrl } : {}),
      };
      setSettings(moduleKey, st);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "未知 action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "写入站点标签数据失败" }, { status: 500 });
  }
}
