// Spec: 010-ai-vc-watch — GET /api/vc/stats?by=sector|month&source=&sector=

import { NextResponse, type NextRequest } from "next/server";
import { getVcStats } from "@/application/vc-service";
import { VcDataError } from "@/infrastructure/sqlite-vc-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const by = searchParams.get("by") === "month" ? "month" : "sector";
  const source = searchParams.get("source") ?? undefined;
  const sector = searchParams.get("sector") ?? undefined;

  try {
    const stats = await getVcStats(by, { source, sector });
    return NextResponse.json(stats);
  } catch (cause) {
    const message = cause instanceof VcDataError ? cause.message : "读取创投统计失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
