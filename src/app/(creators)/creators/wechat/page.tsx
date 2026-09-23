// Spec: 016-nav-modules — 自媒体: 微信公众号后台
// 桌面版: webview 内嵌官网, 手机扫码登录, session 持久化 (D3)
// Web 版: 直接外链 (FR-5)

import WebviewFrame from "@/components/leaderboard/webview-frame";
import ExternalLinkHint from "@/components/creators/external-link-hint";

const MP_URL = "https://mp.weixin.qq.com/";

export default function WechatPage() {
  return (
    <WebviewFrame
      src={MP_URL}
      title="微信公众号后台"
      partition="persist:snuby-creators"
      fallback={<ExternalLinkHint label="微信公众号后台" url={MP_URL} />}
    />
  );
}
