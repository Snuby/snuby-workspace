// Spec: 002-macro-alerts — 告警评估结果 (与 /alerts 页共用同一用例)

import { NextResponse } from "next/server";
import { getAlertsReport } from "@/application/alert-service";
import { MacroDataError } from "@/infrastructure/sqlite-macro-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAlertsReport());
  } catch (cause) {
    const message =
      cause instanceof MacroDataError ? cause.message : "读取宏观数据失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
