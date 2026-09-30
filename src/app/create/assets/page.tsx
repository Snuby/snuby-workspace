"use client";

// 创作中心 · 素材库 (内容占位)

import Topbar from "@/components/workbench/topbar";

export default function CreateAssetsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Topbar title="素材库" crumb="创作中心" />
      <div className="flex-1" />
    </div>
  );
}
