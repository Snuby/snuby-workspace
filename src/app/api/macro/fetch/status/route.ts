// Spec: 003-manual-fetch — 查询抓取任务状态

import { NextResponse } from "next/server";
import { getFetchStatus } from "@/application/fetch-service";

export async function GET() {
  return NextResponse.json(getFetchStatus());
}
