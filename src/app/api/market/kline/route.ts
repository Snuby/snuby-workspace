// Spec: 009-market-quotes — GET /api/market/kline?symbol=&period=&range=

import { NextResponse, type NextRequest } from "next/server";
import { getAssetSeries } from "@/application/market-service";
import { MarketDataError } from "@/infrastructure/sqlite-market-repository";
import { DEFAULT_PERIOD, DEFAULT_RANGE, PERIODS, RANGES, type Period, type Range } from "@/domain/market";

export const dynamic = "force-dynamic";

function parsePeriod(value: string | null): Period {
  const hit = PERIODS.find((p) => p.id === value);
  return hit ? hit.id : DEFAULT_PERIOD;
}

function parseRange(value: string | null): Range {
  const hit = RANGES.find((r) => r.id === value);
  return hit ? hit.id : DEFAULT_RANGE;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "缺少 symbol 参数" }, { status: 400 });
  }
  try {
    const data = await getAssetSeries(
      symbol,
      parsePeriod(searchParams.get("period")),
      parseRange(searchParams.get("range")),
    );
    return NextResponse.json(data);
  } catch (cause) {
    const message = cause instanceof MarketDataError ? cause.message : "读取行情 K 线失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
