// Spec: 012-electron-packaging — Electron 主进程 (唯一产品形态: APP, 无独立 Web 版)
// next 生产服务器以 utilityProcess.fork 运行; 端口 3310+ 探测。
// 软件目录 (安装/仓库) 与用户数据分离:
//   用户数据根 = ~/snuby-workspace-data (SNUBY_USER_DATA 可覆盖)
//   含主题库 + Agent 会话与工作区; 启动时从旧路径幂等迁移。

const { app, BrowserWindow, dialog, session, utilityProcess, Menu, clipboard, ipcMain, webContents } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const APP_TITLE = "Snuby 工作台";
/** 用户数据根: 使用过程产生的全部业务数据（主题库、Agent 会话等） */
const USER_DATA_ROOT = process.env.SNUBY_USER_DATA?.trim() || path.join(os.homedir(), "snuby-workspace-data");

// Spec: 016 — 开发态与打包态数据隔离: package.json name = "snuby-workspace" 使开发态
// userData 与打包版相同 → 单实例锁互相排斥 (用户运行打包版时开发壳无法启动), 且开发壳
// 会读写用户真实数据。开发态改用独立 profile (snuby-dev), 打包版行为不变。
if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "snuby-dev"));
}

// Spec: 013 webview 内嵌第三方官网; 015 起取消导航白名单 — 内嵌 webview 默认放行所有导航
// (用户决定: 不限制可访问网站)。webview 内 target=_blank / window.open 拒绝弹新窗口,
// 改为 webview 内部导航 (量子位等媒体文章链接均为 target=_blank, 无处理时点击被静默吞掉);
// 非 webview (主页面 OAuth 弹窗等) 保持放行。
// 权限: webview 全拒 (摄像头/定位/通知等); 主页面默认放行 (本项目主页面无特殊权限)
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (contents.getType() === "webview") {
      // 站内 target=_blank / window.open → 不弹新窗口, 通知宿主页面以站内标签页打开
      // (宿主 React 监听 window 的 snuby-webview-popup 事件; guestId 用于定位所属模块/站点组)
      const host = contents.hostWebContents;
      if (host && !host.isDestroyed()) {
        try {
          host.executeJavaScript(
            `window.dispatchEvent(new CustomEvent("snuby-webview-popup", { detail: { url: ${JSON.stringify(url)}, guestId: ${contents.id} } }))`,
          );
        } catch {}
      }
    }
    return { action: "deny" };
  });

  // 浏览器风格默认右键菜单 (宿主页面与 webview guest 统一生效):
  // Electron 默认不显示任何右键菜单, 这里补齐 Chrome 效果:
  // 导航(后退/前进/重新加载) / 编辑(撤销/重做/剪切/复制/粘贴/全选) /
  // 链接(站内新标签打开/复制链接) / 页面(打印/另存为/检查元素)
  contents.on("context-menu", (_e, params) => {
    const template = [];
    const nav = contents.navigationHistory;
    if (nav && nav.canGoBack()) template.push({ label: "后退", click: () => nav.goBack() });
    if (nav && nav.canGoForward()) template.push({ label: "前进", click: () => nav.goForward() });
    if (template.length) template.push({ type: "separator" });
    if (params.isEditable) {
      template.push(
        { label: "撤销", enabled: !!params.editFlags.canUndo, click: () => contents.undo() },
        { label: "重做", enabled: !!params.editFlags.canRedo, click: () => contents.redo() },
        { type: "separator" },
      );
      template.push(
        { label: "剪切", enabled: !!params.editFlags.canCut, click: () => contents.cut() },
        { label: "复制", enabled: !!params.editFlags.canCopy, click: () => contents.copy() },
        { label: "粘贴", enabled: !!params.editFlags.canPaste, click: () => contents.paste() },
        { label: "全选", enabled: !!params.editFlags.canSelectAll, click: () => contents.selectAll() },
      );
    } else if (params.selectionText) {
      template.push({ label: "复制", click: () => contents.copy() });
      template.push({ label: "全选", click: () => contents.selectAll() });
    }
    if (template.length) template.push({ type: "separator" });
    if (params.linkURL) {
      if (contents.getType() === "webview") {
        // 站内新标签打开: 与 target=_blank 同一通道 (宿主按 guestId 枚举匹配 → openTab)
        template.push({
          label: "在新标签打开",
          click: () => {
            const host = contents.hostWebContents;
            if (host && !host.isDestroyed()) {
              try {
                host.executeJavaScript(
                  `window.dispatchEvent(new CustomEvent("snuby-webview-popup", { detail: { url: ${JSON.stringify(params.linkURL)}, guestId: ${contents.id} } }))`,
                );
              } catch {}
            }
          },
        });
      }
      template.push({ label: "复制链接地址", click: () => clipboard.writeText(params.linkURL) });
      template.push({ type: "separator" });
    }
    template.push({ label: "重新加载", click: () => contents.reload() });
    template.push({ label: "打印…", click: () => contents.print() });
    template.push({
      label: "页面另存为…",
      click: async () => {
        const win = BrowserWindow.fromWebContents(contents);
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: "页面另存为",
          defaultPath: "page.html",
          filters: [{ name: "HTML", extensions: ["html"] }],
        });
        if (!canceled && filePath) contents.savePage(filePath, "HTMLOnly");
      },
    });
    template.push({ type: "separator" });
    template.push({ label: "检查元素", click: () => contents.inspectElement(params.x, params.y) });
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(contents) });
    }
  });
});

// 单实例锁: 双击/重复启动时聚焦已有窗口而非再开一个
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/** 打包态: extraResources 模板; 开发态: 项目根 (electron . 时 appPath=项目根) */
function bundledRoot() {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

/** 文件: 目标不存在则从源复制 */
function migrateFile(src, dest) {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

/** 目录: 目标不存在则整树复制; 已存在则只补缺失子项 (不覆盖)。
 *  仅用于非会话类数据; 会话目录请用 migrateDirOnce, 否则「用户删除的子项」会被旧源回填。 */
function migrateDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  if (!fs.existsSync(dest)) {
    fs.cpSync(src, dest, { recursive: true });
    return true;
  }
  let any = false;
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    try {
      if (fs.statSync(s).isDirectory()) {
        if (migrateDir(s, d)) any = true;
      } else if (migrateFile(s, d)) {
        any = true;
      }
    } catch {
      // 单文件失败跳过
    }
  }
  return any;
}

/** 会话/工作区: 仅当目标根目录尚不存在时整树迁入一次; 绝不回填已删除的子会话 */
function migrateDirOnce(src, dest) {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

/**
 * 初始化用户数据根 ~/snuby-workspace-data:
 * 从旧位置幂等迁入 (项目 data/、Application Support 下 snuby-* /data)
 */
function initUserDataDir() {
  const dataDir = USER_DATA_ROOT;
  fs.mkdirSync(dataDir, { recursive: true });

  const legacySources = [
    path.join(bundledRoot(), "data"),
    path.join(app.getPath("userData"), "data"),
    path.join(os.homedir(), "Library", "Application Support", "snuby-workspace", "data"),
    path.join(os.homedir(), "Library", "Application Support", "snuby-dev", "data"),
  ];

  const files = ["site_tabs.db"];
  // 会话目录一经迁入用户数据根, 删除只改用户侧; 禁止从仓库 data/ 回填「缺失」子项
  const sessionDirs = ["agent-sessions"];

  for (const srcRoot of legacySources) {
    if (!fs.existsSync(srcRoot)) continue;
    for (const f of files) migrateFile(path.join(srcRoot, f), path.join(dataDir, f));
    for (const d of sessionDirs) migrateDirOnce(path.join(srcRoot, d), path.join(dataDir, d));
  }

  try {
    fs.appendFileSync(
      "/tmp/snuby-next.log",
      `[${new Date().toISOString()}] userDataRoot=${dataDir}\n`,
    );
  } catch {
    // ignore
  }
  return dataDir;
}

/** 桌面端环境: 业务路径指向用户数据根; cwd 为软件资源根 */
function applyDesktopEnv(dataDir) {
  process.env.SNUBY_USER_DATA = dataDir;
  process.env.SITE_TABS_DB_PATH = path.join(dataDir, "site_tabs.db");
  process.env.AGENT_SESSIONS_PATH = path.join(dataDir, "agent-sessions");
  process.chdir(bundledRoot());
}

/** 启动 next 生产服务器 (utilityProcess.fork, 无 Dock 图标), 返回随机可用端口 */
const NEXT_LOG = "/tmp/snuby-next.log";
function logNext(msg) {
  try { fs.appendFileSync(NEXT_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

function startNextServer() {
  // 开发便利: 外部已手动起 next start (如 SNUBY_EXTERNAL_PORT=3310) 时直接复用,
  // 便于单独调试 main 进程而不用每次等 next-server fork。打包态不设置此 env, 行为不变。
  logNext("startNextServer called, SNUBY_EXTERNAL_PORT=" + process.env.SNUBY_EXTERNAL_PORT);
  if (process.env.SNUBY_EXTERNAL_PORT) {
    const port = Number(process.env.SNUBY_EXTERNAL_PORT);
    if (Number.isInteger(port) && port > 0) return Promise.resolve(port);
  }
  return new Promise((resolve, reject) => {
    const cli = path.join(app.getAppPath(), "node_modules", "next", "dist", "bin", "next");
    let attempts = 0;
    const tryPort = (port) => {
      if (attempts > 10) return reject(new Error("未找到可用端口"));
      attempts += 1;
      logNext("fork attempt port=" + port + " cli=" + cli + " appPath=" + app.getAppPath());
      const child = utilityProcess.fork(
        cli,
        ["start", "-H", "127.0.0.1", "-p", String(port)],
        {
          cwd: app.getAppPath(),
          env: { ...process.env },
          stdio: "pipe",
        },
      );
      logNext("fork returned pid=" + child.pid);
      let settled = false;
      let logs = "";
      const net = require("node:net");
      const waitUntilReachable = (deadlineMs) =>
        new Promise((resolve) => {
          const probe = () => {
            const sock = net.connect(port, "127.0.0.1");
            sock.once("connect", () => {
              sock.destroy();
              resolve(true);
            });
            sock.once("error", () => {
              sock.destroy();
              if (Date.now() < deadlineMs) setTimeout(probe, 300);
              else resolve(false);
            });
          };
          probe();
        });
      child.stdout.on("data", async (d) => {
        logs += String(d);
        logNext("stdout: " + String(d).slice(0, 200));
        if (!settled && /Local:|Ready/.test(logs)) {
          settled = true;
          // Ready 打印 ≠ HTTP 可服务 (冷启动时序), 轮询端口就绪再 resolve; 超时视为失败
          const ok = await waitUntilReachable(Date.now() + 20000);
          logNext("port ready check port=" + port + " ok=" + ok);
          if (!ok) return reject(new Error(`端口 ${port} 在 20s 内未就绪`));
          app.on("will-quit", () => {
            try {
              child.kill();
            } catch {}
          });
          resolve(port);
        }
      });
      child.stderr.on("data", (d) => {
        logs += String(d);
      });
      child.on("exit", (code) => {
        logNext("child exit code=" + code + " settled=" + settled + " port=" + port);
        if (!settled) {
          // 端口被占用 (EADDRINUSE) 等非零退出 → 试下一个端口
          if (code !== null) tryPort(port + 1);
          else reject(new Error("next start 启动失败"));
        }
      });
      child.on("error", (e) => {
        logNext("child error: " + String(e));
        if (!settled) reject(e);
      });
    };
    tryPort(3310);
  });
}

/** next 打印 Ready 后首个请求仍可能未就绪 (冷启动慢于监听就绪), loadURL 带重试 */
async function loadURLWithRetry(win, url, retries = 12, gapMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await win.loadURL(url);
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
}

app.whenReady().then(async () => {
  try {
    // 权限: webview 全拒 (摄像头/定位/通知等); 主页面默认放行 (本项目主页面无特殊权限)
    session.defaultSession.setPermissionRequestHandler((wc, _permission, callback) => {
      callback(wc.getType() !== "webview");
    });
    const dataDir = initUserDataDir();
    applyDesktopEnv(dataDir);
    const port = await startNextServer();
    const win = new BrowserWindow({
      width: 1440,
      height: 960,
      title: APP_TITLE,
      autoHideMenuBar: true,
      // 隐藏原生标题栏文案 ("Snuby 工作台"); mac 保留红绿灯嵌入内容区
      ...(process.platform === "darwin"
        ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 14 } }
        : {
            titleBarOverlay: {
              color: "#F2F3F5",
              symbolColor: "#1C1F24",
              height: 36,
            },
          }),
      // webviewTag: 桌面版榜单以 <webview> 内嵌第三方官网 (spec 013, AC-A)
      // preload: 清矩阵 partition 等桌面能力
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
        preload: path.join(__dirname, "preload.js"),
      },
    });
    await loadURLWithRetry(win, `http://127.0.0.1:${port}/`);
  } catch (err) {
    try {
      fs.appendFileSync("/tmp/snuby-pack.log", `FATAL ${err && err.stack ? err.stack : String(err)}\n`);
    } catch {}
    dialog.showErrorBox(`${APP_TITLE} 启动失败`, err instanceof Error ? err.message : String(err));
    app.quit();
  }
});

// 重复启动: 聚焦已有窗口
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("window-all-closed", () => app.quit()); // macOS 也退出 (单窗口工具型应用)

// 自媒体账号矩阵: 删除账号时清干净对应 persist partition (仅允许 snuby-matrix 命名空间)
ipcMain.handle("snuby:clear-partition", async (_event, partition) => {
  if (typeof partition !== "string" || !partition.startsWith("persist:snuby-matrix:")) {
    throw new Error("非法 partition");
  }
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();
  try {
    await ses.clearCache();
  } catch {
    // 部分 Electron 版本 clearCache 行为差异, 存储已清即可
  }
  return { ok: true };
});

/** 性能监控快照: 进程内存 + 按 webContentsId 对齐的 guest RSS (KiB) */
ipcMain.handle("snuby:get-perf-snapshot", async (_event, webContentsIds) => {
  const metrics = app.getAppMetrics();
  const byPid = new Map();
  for (const m of metrics) byPid.set(m.pid, m);

  const tabs = {};
  const ids = Array.isArray(webContentsIds) ? webContentsIds : [];
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isFinite(id)) continue;
    try {
      const wc = webContents.fromId(id);
      if (!wc || wc.isDestroyed()) continue;
      const pid = wc.getOSProcessId();
      const m = byPid.get(pid);
      tabs[id] = {
        pid,
        rssKb: m && m.memory ? m.memory.workingSetSize : null,
        type: m ? m.type : null,
      };
    } catch {
      // guest 已销毁等
    }
  }

  return {
    at: Date.now(),
    totalMemBytes: os.totalmem(),
    processes: metrics.map((m) => ({
      pid: m.pid,
      type: m.type,
      name: m.name || "",
      rssKb: m.memory ? m.memory.workingSetSize : 0,
      cpu: m.cpu && typeof m.cpu.percentCPUUsage === "number" ? m.cpu.percentCPUUsage : 0,
    })),
    tabs,
  };
});
