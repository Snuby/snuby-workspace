// 自媒体账号矩阵: 平台列表 / 新建 / 更新 / 删除
import { NextResponse } from "next/server";
import {
  createMatrixPlatform,
  deleteMatrixPlatform,
  listMatrixPlatforms,
  updateMatrixPlatform,
} from "@/infrastructure/matrix-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ platforms: listMatrixPlatforms() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取平台失败" },
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

  const action = typeof body.action === "string" ? body.action : "create";

  if (action === "rename" || action === "update") {
    const id = typeof body.id === "string" ? body.id : "";
    const name = typeof body.name === "string" ? body.name : undefined;
    const homeUrl = typeof body.homeUrl === "string" ? body.homeUrl : undefined;
    const homeTitle = typeof body.homeTitle === "string" ? body.homeTitle : undefined;
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
    try {
      const platform = updateMatrixPlatform(id, { name, homeUrl, homeTitle });
      return NextResponse.json({ ok: true, platform });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "更新失败" },
        { status: 400 },
      );
    }
  }

  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
    try {
      const result = deleteMatrixPlatform(id);
      if (!result) return NextResponse.json({ error: "平台不存在" }, { status: 404 });
      // partitionKeys 由桌面端逐个 clearPartition
      return NextResponse.json({ ok: true, partitionKeys: result.partitionKeys });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "删除失败" },
        { status: 500 },
      );
    }
  }

  const name = typeof body.name === "string" ? body.name : "";
  const homeUrl = typeof body.homeUrl === "string" ? body.homeUrl : "";
  const homeTitle = typeof body.homeTitle === "string" ? body.homeTitle : undefined;
  try {
    const platform = createMatrixPlatform({ name, homeUrl, homeTitle });
    return NextResponse.json({ ok: true, platform });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建平台失败" },
      { status: 400 },
    );
  }
}
