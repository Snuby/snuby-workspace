/** 桌面端注入 API (electron/preload.js) */
export type SnubyDesktopApi = {
  clearPartition: (partition: string) => Promise<{ ok: boolean }>;
};

declare global {
  interface Window {
    snubyDesktop?: SnubyDesktopApi;
  }
}

export {};
