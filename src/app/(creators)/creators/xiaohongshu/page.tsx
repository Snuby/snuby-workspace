// Spec: 016-nav-modules — 自媒体: 小红书创作中心
// 桌面版: webview 内嵌官网, 登录二维码/验证码在 webview 内展示 (用户手机完成), session 持久化 (D3)
// Web 版: 直接外链 (登录页无内嵌价值, FR-5)

import WebviewFrame from "@/components/leaderboard/webview-frame";
import ExternalLinkHint from "@/components/creators/external-link-hint";

const XHS_URL = "https://creator.xiaohongshu.com/";

export default function XiaohongshuPage() {
  return (
    <WebviewFrame
      src={XHS_URL}
      title="小红书创作中心"
      partition="persist:snuby-creators"
      fallback={<ExternalLinkHint label="小红书创作中心" url={XHS_URL} />}
    />
  );
}
