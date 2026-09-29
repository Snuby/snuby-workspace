import { existsSync, statSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import { SESSIONS_ROOT } from "@/infrastructure/agent-session-store";
import { USER_DATA_ROOT } from "@/infrastructure/user-data-paths";

/**
 * 在系统文件管理器中打开目录, 或定位到文件。
 * 仅允许用户数据根 / 会话目录下的绝对路径。
 * body: { path } — 目录直接打开; 文件则在资源管理器中选中/高亮。
 */
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
  if (!existsSync(resolved)) {
    return Response.json({ error: "路径不存在" }, { status: 404 });
  }

  const isDir = statSync(resolved).isDirectory();
  const ok = await openInFileManager(resolved, isDir);
  if (!ok) return Response.json({ error: "打开失败" }, { status: 500 });
  return Response.json({ ok: true, path: resolved });
}

function openInFileManager(target: string, isDir: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];
    if (platform === "darwin") {
      // -R 在 Finder 中显示并选中文件; 目录直接 open
      cmd = "open";
      args = isDir ? [target] : ["-R", target];
    } else if (platform === "win32") {
      cmd = "explorer";
      args = isDir ? [target] : ["/select,", target];
    } else {
      cmd = "xdg-open";
      args = [isDir ? target : path.dirname(target)];
    }
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.unref();
    setTimeout(() => resolve(true), 200);
  });
}
