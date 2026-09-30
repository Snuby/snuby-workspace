/** 桌面端注入 API (electron/preload.js) */
export type SnubyDesktopApi = {
  clearPartition: (partition: string) => Promise<{ ok: boolean }>;
  getPerfSnapshot: (webContentsIds?: number[]) => Promise<SnubyPerfSnapshot>;
};

export type SnubyPerfProcess = {
  pid: number;
  type: string;
  name: string;
  /** Electron workingSetSize, 单位 KiB */
  rssKb: number;
  cpu: number;
};

export type SnubyPerfSnapshot = {
  at: number;
  totalMemBytes: number;
  processes: SnubyPerfProcess[];
  tabs: Record<string, { pid: number; rssKb: number | null; type: string | null }>;
};

declare global {
  interface Window {
    snubyDesktop?: SnubyDesktopApi;
  }
}

export {};
