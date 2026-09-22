// Spec: 010-ai-vc-watch — GET /api/vc/deals (事件流分页/过滤) + POST /api/vc/deals (人工录入)
// 契约见 design 六节: GET 200 / POST 201·400·409

import { NextResponse, type NextRequest } from "next/server";
import { createManualDeal, getDealStream, type ManualDealInput } from "@/application/vc-service";
import { VcDataError } from "@/infrastructure/sqlite-vc-repository";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sector = searchParams.get("sector") ?? undefined;
  const source = searchParams.get("source") ?? undefined;
  const minUsdRaw = searchParams.get("minUsd");
  const minUsd = minUsdRaw ? Number(minUsdRaw) : undefined;
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0) || 0, 0);

  try {
    const stream = await getDealStream({
      sector: sector as never,
      source: source as never,
      minUsd: Number.isFinite(minUsd) ? minUsd : undefined,
      limit,
      offset,
    });
    return NextResponse.json(stream);
  } catch (cause) {
    const message = cause instanceof VcDataError ? cause.message : "读取融资事件失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: ManualDealInput;
  try {
    body = (await request.json()) as ManualDealInput;
  } catch {
    return NextResponse.json({ error: "请求体须为 JSON" }, { status: 400 });
  }

  try {
    const result = await createManualDeal(body);
    if (!result.ok) {
      if (result.code === "validation") {
        return NextResponse.json({ errors: result.errors }, { status: 400 });
      }
      return NextResponse.json(
        { error: `该链接已收录 (${result.duplicateUrl})，确认后仍可录入` },
        { status: 409 },
      );
    }
    return NextResponse.json({ deal: result.deal }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof VcDataError ? cause.message : "写入融资事件失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
