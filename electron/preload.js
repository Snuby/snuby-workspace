// Spec: 014-embed-hosts — preload: 向设置页暴露内嵌白名单读写 (仅此两项, 权限面最小)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("snubyEmbedHosts", {
  get: () => ipcRenderer.invoke("embed-hosts:get"),
  set: (entries) => ipcRenderer.invoke("embed-hosts:set", entries),
});
