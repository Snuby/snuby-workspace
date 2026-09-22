// Spec: 009-market-quotes — POST /api/market/fetch (运行中返回 409)

import { NextResponse } from "next/server";
import { startMarketFetch } from "@/application/market-fetch-service";

export async function POST() {
  const { started, state } = startMarketFetch();
  if (!started) {
    return NextResponse.json(
      { error: "行情抓取任务正在运行中，请等待完成", state },
      { status: 409 },
    );
  }
  return NextResponse.json({ started: true, state });
}
