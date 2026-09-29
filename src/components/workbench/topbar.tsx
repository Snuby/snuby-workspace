// Spec: 001-workbench-mvp — 顶栏 (US-1 AC2)

export default function Topbar({
  title,
  crumb,
  trailing,
}: {
  title: string;
  crumb?: string;
  /** 右侧状态文案 */
  trailing?: string;
}) {
  return (
    <div className="flex h-[42px] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
      <div className="flex min-w-0 items-center">
        <span className="text-[14.5px] font-semibold">{title}</span>
        {crumb ? (
          <span className="ml-2.5 truncate text-[12.5px] text-ink-faint">{crumb}</span>
        ) : null}
      </div>
      {trailing ? (
        <span className="shrink-0 text-[12.5px] text-ink-muted">{trailing}</span>
      ) : null}
    </div>
  );
}
