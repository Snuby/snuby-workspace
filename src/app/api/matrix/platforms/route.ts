// 自媒体账号矩阵: 平台列表
import { NextResponse } from "next/server";
import { listMatrixPlatforms } from "@/infrastructure/matrix-repository";

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
