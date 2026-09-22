// Spec: 010-ai-vc-watch — GET /api/vc/fetch/status (抓取任务状态, 结构同 spec 003/009)

import { NextResponse } from "next/server";
import { getVcFetchStatus } from "@/application/vc-fetch-service";

export async function GET() {
  return NextResponse.json(getVcFetchStatus());
}
