// Spec: 009-market-quotes — GET /api/market/fetch/status

import { NextResponse } from "next/server";
import { getMarketFetchStatus } from "@/application/market-fetch-service";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getMarketFetchStatus());
}
