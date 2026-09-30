// Electron preload: 向渲染进程暴露受控桌面能力
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("snubyDesktop", {
  clearPartition: (partition) => ipcRenderer.invoke("snuby:clear-partition", partition),
  getPerfSnapshot: (webContentsIds) =>
    ipcRenderer.invoke("snuby:get-perf-snapshot", webContentsIds ?? []),
});
