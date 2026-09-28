import { existsSync, statSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import { SESSIONS_ROOT } from "@/infrastructure/agent-session-store";
import { USER_DATA_ROOT } from "@/infrastructure/user-data-paths";

/** 在系统文件管理器中打开本地目录 (仅允许用户数据根 / 会话目录下的绝对路径) */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  const raw = typeof body?.path === "string" ? body.path.trim() : "";
  if (!raw.startsWith("/") || raw.includes("\0") || raw.split("/").includes("..")) {
    return Response.json({ error: "非法路径" }, { status: 400 });
  }
  const resolved = path.resolve(raw);
  const allowedRoots = [path.resolve(USER_DATA_ROOT), path.resolve(SESSIONS_ROOT)];
  if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
    return Response.json({ error: "路径不在允许范围" }, { status: 403 });
  }
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return Response.json({ error: "目录不存在" }, { status: 404 });
  }

  const ok = await openInFileManager(resolved);
  if (!ok) return Response.json({ error: "打开失败" }, { status: 500 });
  return Response.json({ ok: true, path: resolved });
}

function openInFileManager(dir: string): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "explorer" : "xdg-open";
    const child = spawn(cmd, [dir], { detached: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.unref();
    setTimeout(() => resolve(true), 200);
  });
}
