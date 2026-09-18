// Spec: 001-workbench-mvp — GET /api/macro/indicators (契约见 design.md)

import { NextResponse } from "next/server";
import { getMacroDashboard } from "@/application/macro-service";
import { MacroDataError } from "@/infrastructure/sqlite-macro-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dashboard = await getMacroDashboard();
    return NextResponse.json({
      updatedAt: dashboard.updatedAt,
      groups: dashboard.groups,
      indicators: dashboard.sections.flatMap((s) => s.indicators),
    });
  } catch (cause) {
    const message =
      cause instanceof MacroDataError
        ? cause.message
        : "读取宏观数据失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
