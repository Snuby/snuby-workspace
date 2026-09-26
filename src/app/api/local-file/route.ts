import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";

// 本地媒体文件代理: 供 Markdown 渲染器加载 file 路径的图片/视频/PDF
// 仅本机回环可访问; 只允许绝对路径 + 白名单媒体类型; 支持 Range (视频 seek)

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
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path") ?? "";
  // 只允许绝对路径 + 防路径注入
  if (!p.startsWith("/") || p.includes("\0") || p.includes("..")) {
    return new Response("bad path", { status: 400 });
  }
  const ext = (p.split(".").pop() ?? "").toLowerCase();
  const mime = MIME[ext];
  if (!mime) return new Response("unsupported type", { status: 415 });
  if (!existsSync(p) || !statSync(p).isFile()) {
    return new Response("not found", { status: 404 });
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
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(p));
  return new Response(stream as ReadableStream, {
    headers: { "Content-Type": mime, "Accept-Ranges": "bytes", "Content-Length": String(size) },
  });
}
