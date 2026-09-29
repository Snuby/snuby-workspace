import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { getSession, workDirOf } from "@/infrastructure/agent-session-store";

// 本地 Agent: 用户附带文件/图片写入会话 resources/, 消息历史引用绝对路径回显

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\u4e00-\u9fff\-()+ ]+/g, "_").trim() || "file";
  return base.slice(0, 120);
}

function uniquePath(dir: string, name: string): { full: string; name: string } {
  let n = safeName(name);
  let full = path.join(dir, n);
  if (!existsSync(full)) return { full, name: n };
  const stamp = Date.now().toString(36);
  const ext = path.extname(n);
  const stem = path.basename(n, ext);
  n = `${stem}-${stamp}${ext}`;
  full = path.join(dir, n);
  return { full, name: n };
}

function isSafeAbsPath(p: string): boolean {
  if (!p.startsWith("/") || p.includes("\0")) return false;
  return !p.split("/").some((seg) => seg === "..");
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ ok: false, error: "无效表单" }, { status: 400 });
  const sessionId = String(form.get("sessionId") ?? "").trim();
  if (!sessionId || !getSession(sessionId)) {
    return Response.json({ ok: false, error: "会话不存在" }, { status: 404 });
  }

  const dir = path.join(workDirOf(sessionId), "resources");
  mkdirSync(dir, { recursive: true });

  const file = form.get("file");
  const sourcePath = String(form.get("sourcePath") ?? "").trim();

  if (file instanceof File) {
    if (file.size > 25 * 1024 * 1024) {
      return Response.json({ ok: false, error: "文件超过 25MB" }, { status: 413 });
    }
    const stamp = Date.now().toString(36);
    const { full, name } = uniquePath(dir, file.name || `paste-${stamp}`);
    const buf = Buffer.from(await file.arrayBuffer());
    writeFileSync(full, buf);
    return Response.json({
      ok: true,
      path: full,
      name,
      size: buf.length,
      mime: file.type || "",
    });
  }

  // Electron 已有本地绝对路径: 复制进 resources, 历史统一引用会话目录
  if (sourcePath) {
    if (!isSafeAbsPath(sourcePath) || !existsSync(sourcePath)) {
      return Response.json({ ok: false, error: "源文件不存在" }, { status: 400 });
    }
    const { full, name } = uniquePath(dir, path.basename(sourcePath));
    copyFileSync(sourcePath, full);
    return Response.json({
      ok: true,
      path: full,
      name,
      size: 0,
      mime: "",
    });
  }

  return Response.json({ ok: false, error: "缺少文件" }, { status: 400 });
}
