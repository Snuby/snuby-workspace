// Electron preload: 向渲染进程暴露受控桌面能力 (清矩阵 partition 等)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("snubyDesktop", {
  clearPartition: (partition) => ipcRenderer.invoke("snuby:clear-partition", partition),
});
