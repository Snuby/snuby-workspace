"use client";

// 创作中心 · 作品创作 (内容占位)

import Topbar from "@/components/workbench/topbar";

export default function CreateWorksPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Topbar title="作品创作" crumb="创作中心" />
      <div className="flex-1" />
    </div>
  );
}
