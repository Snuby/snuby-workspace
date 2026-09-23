// Spec: 016-nav-modules — 「Web 访问」路由组共享外壳

import Topbar from "@/components/workbench/topbar";

export default function BrowserLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Topbar title="Web 访问" />
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </>
  );
}
