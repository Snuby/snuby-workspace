// 自媒体账号矩阵: 账号 CRUD
import { NextResponse } from "next/server";
import {
  addMatrixAccount,
  deleteMatrixAccount,
  getActiveMatrixAccountId,
  listMatrixAccounts,
  renameMatrixAccount,
  setActiveMatrixAccountId,
} from "@/infrastructure/matrix-repository";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const platformId = new URL(req.url).searchParams.get("platform");
  if (!platformId) return NextResponse.json({ error: "缺少 platform" }, { status: 400 });
  try {
    const accounts = listMatrixAccounts(platformId);
    const activeAccountId = getActiveMatrixAccountId(platformId);
    return NextResponse.json({ accounts, activeAccountId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取账号失败" },
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
  try {
    const action = body.action;
    const platformId = typeof body.platformId === "string" ? body.platformId : "";
    if (!platformId) return NextResponse.json({ error: "缺少 platformId" }, { status: 400 });

    if (action === "add") {
      const displayName = typeof body.displayName === "string" ? body.displayName : undefined;
      const account = addMatrixAccount(platformId, displayName);
      return NextResponse.json({ ok: true, account });
    }
    if (action === "rename") {
      const accountId = typeof body.accountId === "string" ? body.accountId : "";
      const displayName = typeof body.displayName === "string" ? body.displayName : "";
      if (!accountId || !displayName.trim()) {
        return NextResponse.json({ error: "缺少 accountId 或 displayName" }, { status: 400 });
      }
      const account = renameMatrixAccount(platformId, accountId, displayName);
      if (!account) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
      return NextResponse.json({ ok: true, account });
    }
    if (action === "delete") {
      const accountId = typeof body.accountId === "string" ? body.accountId : "";
      if (!accountId) return NextResponse.json({ error: "缺少 accountId" }, { status: 400 });
      const result = deleteMatrixAccount(platformId, accountId);
      if (!result) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
      // partition 清理由桌面端 renderer 调 snubyDesktop.clearPartition
      return NextResponse.json({ ok: true, partitionKey: result.partitionKey });
    }
    if (action === "activate") {
      const accountId =
        body.accountId === null
          ? null
          : typeof body.accountId === "string"
            ? body.accountId
            : "";
      if (accountId === "") return NextResponse.json({ error: "缺少 accountId" }, { status: 400 });
      setActiveMatrixAccountId(platformId, accountId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "未知 action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "写入账号失败" },
      { status: 500 },
    );
  }
}
