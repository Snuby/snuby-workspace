// 本地 Agent 运行态广播: 面板与侧栏跨路由共享「是否有任务在跑」
// TopicHost 常驻挂载后, 切到主题仍靠这份单例显示侧栏反馈。

type Listener = () => void;

let runningCount = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

/** 面板在 runningIds 变化时同步 */
export function setAgentRunningCount(n: number): void {
  const next = Math.max(0, Math.floor(n));
  if (next === runningCount) return;
  runningCount = next;
  emit();
}

export function getAgentRunningCount(): number {
  return runningCount;
}

export function subscribeAgentRunning(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
