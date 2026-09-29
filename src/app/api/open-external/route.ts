import { spawn } from "child_process";

/**
 * 用系统默认浏览器打开 http(s) 链接。
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
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Response.json({ error: "仅支持 http(s)" }, { status: 400 });
  }

  const ok = await openInBrowser(parsed.toString());
  if (!ok) return Response.json({ error: "打开失败" }, { status: 500 });
  return Response.json({ ok: true });
}

function openInBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];
    if (platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.unref();
    resolve(true);
  });
}
