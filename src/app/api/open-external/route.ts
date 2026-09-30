import { spawn } from "child_process";

/**
 * 用系统默认应用打开 http(s) 或本地 file://（仅限本地 html/htm）。
 * Electron 主页 setWindowOpenHandler 一律 deny，target=_blank / window.open 无效，需走此接口。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const raw = typeof body?.url === "string" ? body.url.trim() : "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return Response.json({ error: "非法 URL" }, { status: 400 });
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    const ok = await openWithSystem(parsed.toString());
    if (!ok) return Response.json({ error: "打开失败" }, { status: 500 });
    return Response.json({ ok: true });
  }

  if (parsed.protocol === "file:") {
    // file:///path → /path; 仅允许本地 html/htm
    let filePath = decodeURIComponent(parsed.pathname);
    // macOS 上 file:///Users/... pathname 已是 /Users/...
    if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(filePath)) {
      filePath = filePath.slice(1);
    }
    if (!filePath.startsWith("/") || filePath.includes("\0") || filePath.split("/").includes("..")) {
      return Response.json({ error: "非法路径" }, { status: 400 });
    }
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "html" && ext !== "htm") {
      return Response.json({ error: "仅支持本地 html/htm" }, { status: 400 });
    }
    const { existsSync, statSync } = await import("fs");
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return Response.json({ error: "文件不存在" }, { status: 404 });
    }
    const ok = await openWithSystem(filePath);
    if (!ok) return Response.json({ error: "打开失败" }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "仅支持 http(s) 或本地 html" }, { status: 400 });
}

function openWithSystem(target: string): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];
    if (platform === "darwin") {
      cmd = "open";
      args = [target];
    } else if (platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", target];
    } else {
      cmd = "xdg-open";
      args = [target];
    }
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.unref();
    resolve(true);
  });
}
