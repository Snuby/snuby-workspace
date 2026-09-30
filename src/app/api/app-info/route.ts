import os from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { USER_DATA_ROOT } from "@/infrastructure/user-data-paths";

export const dynamic = "force-dynamic";

function readPackageVersion(): string {
  try {
    const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    const v = (JSON.parse(raw) as { version?: string }).version;
    return typeof v === "string" && v ? v : "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function displayUserDataPath(abs: string): string {
  const home = os.homedir();
  if (abs === home || abs.startsWith(home + path.sep)) {
    return "~" + abs.slice(home.length);
  }
  return abs;
}

export async function GET() {
  return NextResponse.json({
    version: readPackageVersion(),
    userDataPath: USER_DATA_ROOT,
    userDataPathDisplay: displayUserDataPath(USER_DATA_ROOT),
  });
}
