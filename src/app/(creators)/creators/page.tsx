// Spec: 016-nav-modules — /creators 根路径重定向到默认页 (小红书创作中心)

import { redirect } from "next/navigation";

export default function CreatorsIndexPage() {
  redirect("/creators/xiaohongshu");
}
