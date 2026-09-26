"use client";

// 实验室 · 本地 Agent: 站点地址以 snuby:// 开头时渲染本组件 (而非 webview)
// 当前为欢迎占位页; 后续在此接入本地 Agent 能力面板。

export default function LocalAgentPanel() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface">
      <div className="max-w-[420px] px-6 text-center">
        <div className="text-[15px] font-semibold text-ink">欢迎使用本地 Agent</div>
        <div className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
          这是「实验室」的第一个子板块，能力正在建设中。
          <br />
          后续本地 Agent 将在这里运行。
        </div>
      </div>
    </div>
  );
}
