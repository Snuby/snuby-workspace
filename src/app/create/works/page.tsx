"use client";

import Topbar from "@/components/workbench/topbar";
import CreateWorksPanel from "@/components/create/create-works-panel";

export default function CreateWorksPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Topbar title="作品创作" crumb="创作中心" />
      <div className="min-h-0 flex-1">
        <CreateWorksPanel />
      </div>
    </div>
  );
}
