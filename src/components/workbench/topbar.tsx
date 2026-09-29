// Spec: 001-workbench-mvp — 顶栏 (US-1 AC2)

export default function Topbar({ title, crumb }: { title: string; crumb?: string }) {
  return (
    <div className="flex h-[42px] shrink-0 items-center border-b border-line bg-surface px-4">
      <span className="text-[14.5px] font-semibold">{title}</span>
      {crumb ? (
        <span className="ml-2.5 text-[12.5px] text-ink-faint">{crumb}</span>
      ) : null}
    </div>
  );
}
