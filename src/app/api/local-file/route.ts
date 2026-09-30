import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { Readable } from "stream";

// 本地媒体文件代理: 供 Markdown 渲染器加载 file 路径的图片/视频/PDF
// 仅本机回环可访问; 只允许绝对路径 + 白名单媒体类型; 支持 Range (视频 seek)
// list=1: 列出目录内白名单媒体 (预览 404 时提示同目录可用文件)

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  pdf: "application/pdf",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  jsonl: "application/x-ndjson",
  log: "text/plain",
  html: "text/html",
  htm: "text/html",
  yml: "text/yaml",
  yaml: "text/yaml",
  csv: "text/csv",
  xml: "text/xml",
  ts: "text/plain",
  tsx: "text/plain",
  js: "text/plain",
  jsx: "text/plain",
  py: "text/plain",
  go: "text/plain",
  rs: "text/plain",
  java: "text/plain",
  c: "text/plain",
  cpp: "text/plain",
  h: "text/plain",
  sh: "text/plain",
  bash: "text/plain",
  zsh: "text/plain",
  sql: "text/plain",
  ini: "text/plain",
  toml: "text/plain",
  conf: "text/plain",
};

function extOf(p: string): string {
  const base = basename(p);
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

function isSafeAbsPath(p: string): boolean {
  if (!p.startsWith("/") || p.includes("\0")) return false;
  return !p.split("/").some((seg) => seg === "..");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path") ?? "";
  if (!isSafeAbsPath(p)) {
    return new Response("bad path", { status: 400 });
  }

  // 元信息: 预览标题旁展示文件大小等; 目录也可探测 (点击打开文件夹)
  if (url.searchParams.get("stat") === "1") {
    if (!existsSync(p)) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const st = statSync(p);
    if (st.isDirectory()) {
      return Response.json({
        name: basename(p),
        isDirectory: true,
        isFile: false,
        size: 0,
        mtime: st.mtimeMs,
      });
    }
    if (!st.isFile()) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json({
      name: basename(p),
      isDirectory: false,
      isFile: true,
      size: st.size,
      mtime: st.mtimeMs,
    });
  }

  // 目录列举: 预览找不到文件时, 前端可提示同目录媒体
  if (url.searchParams.get("list") === "1") {
    if (!existsSync(p) || !statSync(p).isDirectory()) {
      return new Response("not found", { status: 404 });
    }
    const entries: { name: string; path: string; size: number; mime: string }[] = [];
    for (const name of readdirSync(p)) {
      const mime = MIME[extOf(name)];
      if (!mime) continue;
      const full = join(p, name);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
        entries.push({ name, path: full, size: st.size, mime });
      } catch {
        // skip unreadable
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    return Response.json({ entries });
  }

  const mime = MIME[extOf(p)];
  if (!mime) return new Response("unsupported type", { status: 415 });
  if (!existsSync(p) || !statSync(p).isFile()) {
    return new Response(JSON.stringify({ error: "not found", path: p, dir: dirname(p) }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const size = statSync(p).size;
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m?.[1] ? parseInt(m[1], 10) : 0;
    const end = m?.[2] ? parseInt(m[2], 10) : size - 1;
    if (start >= size) return new Response(null, { status: 416 });
    const stream = Readable.toWeb(createReadStream(p, { start, end }));
    return new Response(stream as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Cache-Control": "no-store",
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(p));
  return new Response(stream as ReadableStream, {
    headers: {
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    },
  });
}
