// Spec: 009-market-quotes — GET /api/market/assets (契约见 design.md 第六节)

import { NextResponse } from "next/server";
import { getMarketOverview } from "@/application/market-service";
import { MarketDataError } from "@/infrastructure/sqlite-market-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getMarketOverview());
  } catch (cause) {
    const message = cause instanceof MarketDataError ? cause.message : "读取行情数据失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
