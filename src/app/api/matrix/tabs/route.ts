// 自媒体账号矩阵: 账号标签页持久化
import { NextResponse } from "next/server";
import { loadMatrixTabs, saveMatrixTabs } from "@/infrastructure/matrix-repository";
import type { MatrixTab } from "@/lib/matrix-types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const platformId = url.searchParams.get("platform");
  const accountId = url.searchParams.get("account");
  if (!platformId || !accountId) {
    return NextResponse.json({ error: "缺少 platform 或 account" }, { status: 400 });
  }
  try {
    return NextResponse.json({ tabs: loadMatrixTabs(platformId, accountId) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取标签失败" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const platformId = typeof body.platformId === "string" ? body.platformId : "";
  const accountId = typeof body.accountId === "string" ? body.accountId : "";
  if (!platformId || !accountId) {
    return NextResponse.json({ error: "缺少 platformId 或 accountId" }, { status: 400 });
  }
  const raw = Array.isArray(body.tabs) ? body.tabs : [];
  const tabs: MatrixTab[] = raw
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const url = typeof o.url === "string" ? o.url : "";
      const title = typeof o.title === "string" ? o.title : "";
      if (!id || !url) return null;
      return { id, url, title };
    })
    .filter((t): t is MatrixTab => !!t);
  try {
    saveMatrixTabs(platformId, accountId, tabs);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存标签失败" },
      { status: 500 },
    );
  }
}
