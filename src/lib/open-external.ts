/** 系统默认应用打开 http(s)，或本地 html/htm（file:// / 绝对路径）。Electron 拦截了 window.open。 */
export async function openInSystemBrowser(urlOrPath: string): Promise<void> {
  let url = urlOrPath.trim();
  if (url.startsWith("/") && /\.(html?|HTML?)$/.test(url)) {
    url = `file://${url}`;
  }
  const r = await fetch("/api/open-external", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `HTTP ${r.status}`);
  }
}
