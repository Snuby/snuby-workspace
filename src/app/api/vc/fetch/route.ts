// Spec: 010-ai-vc-watch — POST /api/vc/fetch (运行中返回 409)

import { NextResponse } from "next/server";
import { startVcFetch } from "@/application/vc-fetch-service";

export async function POST() {
  const { started, state } = startVcFetch();
  if (!started) {
    return NextResponse.json(
      { error: "创投抓取任务正在运行中，请等待完成", state },
      { status: 409 },
    );
  }
  return NextResponse.json({ started: true, state });
}
