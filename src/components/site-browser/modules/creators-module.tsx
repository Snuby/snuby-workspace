"use client";

// Spec: 017-site-tabs — 自媒体模块 (常驻容器用, 跨模块保留浏览状态)
// 所有标签共享 persist:snuby-creators 分区 → 登录态互通 (扫一次码全标签通用)。

import SiteBrowser from "@/components/site-browser/site-browser";

const SITES = [
  { id: "xiaohongshu", label: "小红书创作中心", url: "https://creator.xiaohongshu.com/", partition: "persist:snuby-creators" },
  { id: "wechat", label: "微信公众号后台", url: "https://mp.weixin.qq.com/", partition: "persist:snuby-creators" },
];

export default function CreatorsModule({ active }: { active?: boolean }) {
  return <SiteBrowser
          active={active} moduleKey="creators" title="自媒体" sites={SITES} />;
}
