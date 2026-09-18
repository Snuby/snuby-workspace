// Spec: 003-manual-fetch — 启动抓取 (运行中返回 409)

import { NextResponse } from "next/server";
import { startFetch } from "@/application/fetch-service";

export async function POST() {
  const { started, state } = startFetch();
  if (!started) {
    return NextResponse.json(
      { error: "抓取任务正在运行中，请等待完成", state },
      { status: 409 },
    );
  }
  return NextResponse.json({ started: true, state });
}
