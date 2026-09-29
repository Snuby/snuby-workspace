/** 系统默认浏览器打开 http(s)。Electron 拦截了 window.open / target=_blank。 */
export async function openInSystemBrowser(url: string): Promise<void> {
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
