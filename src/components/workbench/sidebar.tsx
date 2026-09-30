"use client";

// 灵活工作台: 左侧菜单 = 工作台首页 + 创作中心 + 自媒体账号矩阵
// + 主题区 + 拓展 (Web 访问 / 本地 Agent) + 系统
// 主题区来自 /api/topics; 矩阵平台来自 /api/matrix/platforms (可新建)

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTopics, type Topic } from "@/components/workbench/topics-context";
import { topicIcon } from "@/components/workbench/topic-icon";
import { useClickOutside } from "@/lib/use-click-outside";
import {
  getAgentRunningCount,
  subscribeAgentRunning,
} from "@/infrastructure/agent-run-presence";
import {
  getMonitorAlerting,
  subscribeMonitorAlerting,
} from "@/lib/monitor-alert";
import type { MatrixPlatform } from "@/lib/matrix-types";
import { MATRIX_PLATFORM_PRESETS } from "@/lib/matrix-presets";
import { MatrixBrandIcon } from "@/components/ui/matrix-brand-icon";

type NavLeaf = {
  href: string;
  label: string;
  icon: ReactNode;
  /** 一对多激活判定: 缺省时按路径精确相等 */
  match?: readonly string[];
};

const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  ),
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
    </svg>
  ),
  flask: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M9 3h6" />
      <path d="M10 3v6.3L4.7 19a2 2 0 0 0 1.8 3h11a2 2 0 0 0 1.8-3L14 9.3V3" />
      <path d="M7 15h10" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  ),
  /** 作品创作: 笔 + 画板 */
  createWorks: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  /** 素材库: 图片叠层 */
  createAssets: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]">
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="M7 3h12a2 2 0 0 1 2 2v12" />
      <circle cx="9.5" cy="10.5" r="1.5" />
      <path d="m17 19-4.5-4.5L8 19" />
    </svg>
  ),
};

/** 对话框内胶囊: 点击仅填充名称/地址, 不提交 */
function MatrixPresetCapsules({
  onPick,
}: {
  onPick: (name: string, homeUrl: string) => void;
}) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11.5px] text-ink-faint">常见创作后台（点击填入，不提交）</p>
      <div className="flex flex-wrap gap-1.5">
        {MATRIX_PLATFORM_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.homeUrl}
            onClick={() => onPick(p.name, p.homeUrl)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent-deep active:scale-[0.98]"
          >
            <MatrixBrandIcon platformId={p.id} size={14} />
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 固定区导航 (主题区动态渲染在下) */
const NAV: NavLeaf[] = [
  { href: "/", label: "工作台首页", icon: ICONS.home },
];

function itemClass(active: boolean): string {
  return [
    "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] transition-colors duration-150",
    active
      ? "bg-accent-soft font-medium text-accent-deep"
      : "text-ink hover:bg-hover",
  ].join(" ");
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { topics, createTopic, renameTopic, deleteTopic } = useTopics();
  const agentRunning = useSyncExternalStore(
    subscribeAgentRunning,
    getAgentRunningCount,
    () => 0,
  );
  const monitorAlert = useSyncExternalStore(
    subscribeMonitorAlerting,
    getMonitorAlerting,
    () => false,
  );

  const [platforms, setPlatforms] = useState<MatrixPlatform[] | null>(null);
  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [topicName, setTopicName] = useState("");
  const [topicBusy, setTopicBusy] = useState(false);
  const [topicErr, setTopicErr] = useState("");

  const [matrixDialogOpen, setMatrixDialogOpen] = useState(false);
  const [matrixName, setMatrixName] = useState("");
  const [matrixUrl, setMatrixUrl] = useState("");
  const [matrixBusy, setMatrixBusy] = useState(false);
  const [matrixErr, setMatrixErr] = useState("");

  /** 当前展开 ⋯ 菜单 */
  const [menuFor, setMenuFor] = useState<{ type: "topic" | "matrix"; id: string } | null>(null);
  /** 重命名/编辑弹窗目标 */
  const [renameDialog, setRenameDialog] = useState<{
    type: "topic" | "matrix";
    id: string;
    name: string;
    homeUrl?: string;
  } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameUrl, setRenameUrl] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  useClickOutside(menuRef, menuFor !== null, () => setMenuFor(null));

  const refreshPlatforms = async () => {
    try {
      const r = await fetch("/api/matrix/platforms", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { platforms?: MatrixPlatform[] };
      if (Array.isArray(j.platforms)) setPlatforms(j.platforms);
    } catch {
      // 保持现有
    }
  };

  useEffect(() => {
    void refreshPlatforms();
  }, []);

  function openTopicDialog() {
    setTopicName("");
    setTopicErr("");
    setTopicBusy(false);
    setTopicDialogOpen(true);
    setMenuFor(null);
  }

  function closeTopicDialog() {
    if (topicBusy) return;
    setTopicDialogOpen(false);
    setTopicErr("");
  }

  async function handleCreateTopic() {
    const name = topicName.trim();
    if (!name) {
      setTopicErr("请填写主题名称");
      return;
    }
    setTopicBusy(true);
    setTopicErr("");
    const id = await createTopic(name);
    setTopicBusy(false);
    if (!id) {
      setTopicErr("创建失败，请重试");
      return;
    }
    setTopicDialogOpen(false);
    router.push(`/topic/${id}`);
  }

  function openMatrixDialog() {
    setMatrixName("");
    setMatrixUrl("");
    setMatrixErr("");
    setMatrixBusy(false);
    setMatrixDialogOpen(true);
    setMenuFor(null);
  }

  function closeMatrixDialog() {
    if (matrixBusy) return;
    setMatrixDialogOpen(false);
    setMatrixErr("");
  }

  async function handleCreateMatrix() {
    const name = matrixName.trim();
    const homeUrl = matrixUrl.trim();
    if (!name) {
      setMatrixErr("请填写平台名称");
      return;
    }
    if (!homeUrl) {
      setMatrixErr("请填写创作中心 / 后台地址");
      return;
    }
    setMatrixBusy(true);
    setMatrixErr("");
    try {
      const r = await fetch("/api/matrix/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, homeUrl }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        platform?: MatrixPlatform;
        error?: string;
      };
      if (!r.ok || !j.platform) {
        setMatrixErr(j.error || "创建失败");
        setMatrixBusy(false);
        return;
      }
      await refreshPlatforms();
      setMatrixBusy(false);
      setMatrixDialogOpen(false);
      router.push(`/matrix/${j.platform.id}`);
    } catch {
      setMatrixBusy(false);
      setMatrixErr("创建失败，请重试");
    }
  }

  function openRenameDialog(
    type: "topic" | "matrix",
    id: string,
    name: string,
    homeUrl?: string,
  ) {
    setMenuFor(null);
    setRenameDialog({ type, id, name, homeUrl });
    setRenameName(name);
    setRenameUrl(homeUrl ?? "");
    setRenameErr("");
    setRenameBusy(false);
  }

  function closeRenameDialog() {
    if (renameBusy) return;
    setRenameDialog(null);
    setRenameErr("");
  }

  async function handleRenameSubmit() {
    if (!renameDialog) return;
    const name = renameName.trim();
    if (!name) {
      setRenameErr("请填写名称");
      return;
    }
    if (renameDialog.type === "matrix") {
      const homeUrl = renameUrl.trim();
      if (!homeUrl) {
        setRenameErr("请填写创作中心 / 后台地址");
        return;
      }
      if (name === renameDialog.name && homeUrl === (renameDialog.homeUrl ?? "")) {
        setRenameDialog(null);
        return;
      }
      setRenameBusy(true);
      setRenameErr("");
      try {
        const r = await fetch("/api/matrix/platforms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update",
            id: renameDialog.id,
            name,
            homeUrl,
          }),
        });
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) {
          setRenameErr(j.error || "保存失败");
          setRenameBusy(false);
          return;
        }
        await refreshPlatforms();
        setRenameBusy(false);
        setRenameDialog(null);
      } catch {
        setRenameBusy(false);
        setRenameErr("保存失败，请重试");
      }
      return;
    }

    if (name === renameDialog.name) {
      setRenameDialog(null);
      return;
    }
    setRenameBusy(true);
    setRenameErr("");
    try {
      const ok = await renameTopic(renameDialog.id, name);
      if (!ok) {
        setRenameErr("重命名失败");
        setRenameBusy(false);
        return;
      }
      setRenameBusy(false);
      setRenameDialog(null);
    } catch {
      setRenameBusy(false);
      setRenameErr("重命名失败，请重试");
    }
  }

  async function handleDeleteTopic(t: Topic) {
    if (!window.confirm(`删除主题「${t.name}」？主题内站点、标签与历史将一并清除。`)) return;
    await deleteTopic(t.id);
    setMenuFor(null);
    if (pathname === `/topic/${t.id}`) router.push("/");
  }

  async function handleDeleteMatrix(p: MatrixPlatform) {
    if (
      !window.confirm(
        `删除平台「${p.name}」？\n该平台下全部账号、标签页与登录态将一并清除，且不可恢复。`,
      )
    ) {
      return;
    }
    setMenuFor(null);
    try {
      const r = await fetch("/api/matrix/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: p.id }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        partitionKeys?: string[];
        error?: string;
      };
      if (!r.ok || !j.ok) {
        window.alert(j.error || "删除失败");
        return;
      }
      const keys = Array.isArray(j.partitionKeys) ? j.partitionKeys : [];
      if (typeof window !== "undefined" && window.snubyDesktop?.clearPartition) {
        for (const key of keys) {
          try {
            await window.snubyDesktop.clearPartition(key);
          } catch {
            // 单账号清理失败不阻断其余
          }
        }
      }
      const rest = (platforms ?? []).filter((x) => x.id !== p.id);
      await refreshPlatforms();
      if (pathname === `/matrix/${p.id}`) {
        router.push(rest[0] ? `/matrix/${rest[0].id}` : "/");
      }
    } catch {
      window.alert("删除失败，请重试");
    }
  }

  return (
    <aside className="app-drag flex h-screen w-[228px] shrink-0 flex-col bg-page pt-[36px]">
      <div className="app-no-drag flex items-center gap-2.5 px-4 pb-3.5 pt-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-accent text-[13px] font-bold text-white">
          S
        </div>
        <div className="text-[15px] font-semibold tracking-wide text-ink">Snuby</div>
      </div>

      <nav className="app-no-drag flex-1 overflow-y-auto px-3 pb-3 pt-1">
        {NAV.map((item) => {
          const active = item.match ? item.match.includes(pathname) : pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={itemClass(active)}>
              {item.icon}
              {item.label}
            </Link>
          );
        })}

        <div className="mb-1 mt-4 px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            创作中心
          </span>
        </div>
        <Link href="/create/works" className={itemClass(pathname === "/create/works")}>
          {ICONS.createWorks}
          <span className="min-w-0 flex-1 truncate">作品创作</span>
        </Link>
        <Link href="/create/assets" className={itemClass(pathname === "/create/assets")}>
          {ICONS.createAssets}
          <span className="min-w-0 flex-1 truncate">素材库</span>
        </Link>

        <div className="mb-1 mt-4 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            自媒体账号矩阵
          </span>
          <button
            type="button"
            title="添加平台"
            onClick={openMatrixDialog}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            {ICONS.plus}
          </button>
        </div>
        {platforms === null ? (
          <div className="px-2.5 py-2 text-[12px] text-ink-faint">加载中…</div>
        ) : platforms.length === 0 ? (
          <div className="px-2.5 py-2 text-[12px] text-ink-faint">暂无平台，点右上角 + 添加</div>
        ) : (
          platforms.map((p) => (
            <div key={p.id} className="group relative">
              <Link
                href={`/matrix/${p.id}`}
                className={itemClass(pathname === `/matrix/${p.id}`)}
                title={p.homeUrl}
              >
                <MatrixBrandIcon platformId={p.id} size={15} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </Link>
              <button
                type="button"
                aria-label={`管理平台 ${p.name}`}
                onClick={() =>
                  setMenuFor(
                    menuFor?.type === "matrix" && menuFor.id === p.id
                      ? null
                      : { type: "matrix", id: p.id },
                  )
                }
                className="absolute right-1.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition-colors hover:bg-hover hover:text-ink group-hover:flex"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                  <circle cx="12" cy="5" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="12" cy="19" r="1.6" />
                </svg>
              </button>
              {menuFor?.type === "matrix" && menuFor.id === p.id ? (
                <div
                  ref={menuRef}
                  className="absolute right-0 top-full z-50 mt-1 w-[150px] rounded-lg border border-line bg-white p-1 shadow-xl"
                >
                  <button
                    type="button"
                    onClick={() => openRenameDialog("matrix", p.id, p.name, p.homeUrl)}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteMatrix(p)}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-red-500 hover:bg-red-50"
                  >
                    删除
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}

        <div className="mb-1 mt-4 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">主题</span>
          <button
            type="button"
            title="新建主题"
            onClick={openTopicDialog}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            {ICONS.plus}
          </button>
        </div>

        {topics === null ? (
          <div className="px-2.5 py-2 text-[12px] text-ink-faint">加载中…</div>
        ) : topics.length === 0 ? (
          <div className="px-2.5 py-2 text-[12px] text-ink-faint">暂无主题，点右上角 + 新建</div>
        ) : (
          topics.map((t) => {
            const active = pathname === `/topic/${t.id}`;
            return (
              <div key={t.id} className="group relative">
                <Link href={`/topic/${t.id}`} className={itemClass(active)}>
                  {topicIcon(t.id)}
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                </Link>
                <button
                  type="button"
                  aria-label={`管理主题 ${t.name}`}
                  onClick={() =>
                    setMenuFor(
                      menuFor?.type === "topic" && menuFor.id === t.id
                        ? null
                        : { type: "topic", id: t.id },
                    )
                  }
                  className="absolute right-1.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition-colors hover:bg-hover hover:text-ink group-hover:flex"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                    <circle cx="12" cy="5" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="12" cy="19" r="1.6" />
                  </svg>
                </button>
                {menuFor?.type === "topic" && menuFor.id === t.id ? (
                  <div
                    ref={menuRef}
                    className="absolute right-0 top-full z-50 mt-1 w-[150px] rounded-lg border border-line bg-white p-1 shadow-xl"
                  >
                    <button
                      type="button"
                      onClick={() => openRenameDialog("topic", t.id, t.name)}
                      className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTopic(t)}
                      className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-red-500 hover:bg-red-50"
                    >
                      删除
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        <div className="mb-1 mt-4 px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">拓展</span>
        </div>
        <Link href="/browser" className={itemClass(pathname === "/browser" || pathname.startsWith("/browser/"))}>
          {ICONS.globe}
          <span className="min-w-0 flex-1 truncate">Web 访问</span>
        </Link>
        <Link href="/lab/local-agent" className={itemClass(pathname.startsWith("/lab"))}>
          {ICONS.flask}
          <span className="min-w-0 flex-1 truncate">本地 Agent</span>
          {agentRunning > 0 && (
            <span
              className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-deep"
              title="本地 Agent 有任务正在执行"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              进行中
            </span>
          )}
        </Link>

        <div className="mb-1 mt-4 px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">系统</span>
        </div>
        <Link href="/settings" className={itemClass(pathname === "/settings" || pathname.startsWith("/settings/"))}>
          {ICONS.gear}
          设置
        </Link>
        <Link
          href="/system/monitor"
          title={monitorAlert ? "内存告警：打开监控查看" : undefined}
          className={itemClass(pathname === "/system/monitor" || pathname.startsWith("/system/monitor/"))}
        >
          {ICONS.activity}
          <span className="min-w-0 flex-1 truncate">监控</span>
          {monitorAlert ? (
            <span className="ml-auto shrink-0 rounded-full bg-up px-1.5 py-0.5 text-[10px] font-medium text-white">
              告警
            </span>
          ) : null}
        </Link>
      </nav>

      <div className="app-no-drag border-t border-line px-4 py-3.5 text-[11px] text-ink-faint">
        Snuby Workbench v0.1
      </div>

      {topicDialogOpen ? (
        <FormDialog
          title="新建主题"
          onClose={closeTopicDialog}
          busy={topicBusy}
          error={topicErr}
          confirmLabel="创建"
          onConfirm={() => void handleCreateTopic()}
        >
          <label className="block text-[12px] text-ink-muted">
            主题名称
            <input
              autoFocus
              value={topicName}
              onChange={(e) => setTopicName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateTopic();
                if (e.key === "Escape") closeTopicDialog();
              }}
              placeholder="例如：AI 创投"
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
        </FormDialog>
      ) : null}

      {matrixDialogOpen ? (
        <FormDialog
          title="添加自媒体平台"
          onClose={closeMatrixDialog}
          busy={matrixBusy}
          error={matrixErr}
          confirmLabel="添加"
          onConfirm={() => void handleCreateMatrix()}
        >
          <label className="block text-[12px] text-ink-muted">
            平台名称
            <input
              autoFocus
              value={matrixName}
              onChange={(e) => setMatrixName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeMatrixDialog();
              }}
              placeholder="例如：知乎"
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="mt-3 block text-[12px] text-ink-muted">
            创作中心 / 后台地址
            <input
              value={matrixUrl}
              onChange={(e) => setMatrixUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateMatrix();
                if (e.key === "Escape") closeMatrixDialog();
              }}
              placeholder="例如：https://www.zhihu.com/creator"
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          <MatrixPresetCapsules
            onPick={(name, homeUrl) => {
              setMatrixName(name);
              setMatrixUrl(homeUrl);
              setMatrixErr("");
            }}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            填该平台的创作者后台首页；添加后可在平台里建多个账号槽位分别登录。
          </p>
        </FormDialog>
      ) : null}

      {renameDialog ? (
        <FormDialog
          title={renameDialog.type === "topic" ? "重命名主题" : "编辑自媒体平台"}
          onClose={closeRenameDialog}
          busy={renameBusy}
          error={renameErr}
          confirmLabel="保存"
          onConfirm={() => void handleRenameSubmit()}
        >
          <label className="block text-[12px] text-ink-muted">
            名称
            <input
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameDialog.type === "topic") void handleRenameSubmit();
                if (e.key === "Escape") closeRenameDialog();
              }}
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          {renameDialog.type === "matrix" ? (
            <>
              <label className="mt-3 block text-[12px] text-ink-muted">
                创作中心 / 后台地址
                <input
                  value={renameUrl}
                  onChange={(e) => setRenameUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleRenameSubmit();
                    if (e.key === "Escape") closeRenameDialog();
                  }}
                  placeholder="例如：https://www.zhihu.com/creator"
                  className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
              <MatrixPresetCapsules
                onPick={(name, homeUrl) => {
                  setRenameName(name);
                  setRenameUrl(homeUrl);
                  setRenameErr("");
                }}
              />
            </>
          ) : null}
        </FormDialog>
      ) : null}
    </aside>
  );
}

function FormDialog({
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel,
  busy,
  error,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
}) {
  return (
    <div
      className="app-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-[400px] max-w-[90vw] rounded-xl border border-line bg-white p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[14.5px] font-bold text-ink">{title}</span>
          <button
            type="button"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            ×
          </button>
        </div>
        {children}
        {error ? <p className="mt-2 text-[12px] text-up">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink-muted hover:bg-hover disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
