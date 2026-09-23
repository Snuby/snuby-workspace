// Spec: 017-site-tabs — Web 访问页 (地址栏模式: 全局单组标签, 主页=Google)

import SiteBrowser from "@/components/site-browser/site-browser";

const HOME = [{ id: "default", label: "主页", url: "https://www.google.com/" }];

export default function BrowserPage() {
  return <SiteBrowser moduleKey="browser" title="Web 访问" sites={HOME} addressMode />;
}
