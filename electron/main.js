// Spec: 012-electron-packaging — Electron 主进程
// next 生产服务器以 utilityProcess.fork 运行 (官方「主进程外跑 Node 逻辑」通道):
// 纯后台 Node 进程, 不上 Dock / 无 GUI 身份, 生命周期随主进程 (app 退出自动终止, 不留孤儿占端口)。
// 端口从 3310 起递增探测, 避免与开发端口 3300 冲突。
// 数据契约: MACRO_DB_PATH / MARKET_DB_PATH / FETCH_PYTHON_BIN (与 Web 版同组 env),
// fetch 脚本相对 cwd (process.chdir 到资源根, 含 scripts/)。

const { app, BrowserWindow, dialog, session, utilityProcess } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const APP_TITLE = "Snuby 工作台";
const VENV_PYTHON = "/Users/suweijie/.workbuddy/binaries/python/envs/default/bin/python";

// Spec: 013 webview 内嵌第三方官网; 015 起取消导航白名单 — 内嵌 webview 默认放行所有导航
// (用户决定: 不限制可访问网站)。window.open 保持放行 (OAuth 弹窗登录需要)。
// 权限: webview 全拒 (摄像头/定位/通知等); 主页面默认放行 (本项目主页面无特殊权限)
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "allow" }));
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

/** 初始化数据区: 首次启动把模板 db 复制到 userData, 幂等; 返回数据目录 */
function initDataDir() {
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  if (!app.isPackaged) return dataDir; // 开发态直接用项目 data/, 不复制
  const bundledData = path.join(bundledRoot(), "data");
  for (const file of ["china_economy.db", "market.db"]) {
    const src = path.join(bundledData, file);
    const dest = path.join(dataDir, file);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }
  return dataDir;
}

/** 桌面端环境: 数据目录 + python 解释器 (存在才设) + 工作目录切到资源根 */
function applyDesktopEnv(dataDir) {
  process.env.MACRO_DB_PATH = path.join(dataDir, "china_economy.db");
  process.env.MARKET_DB_PATH = path.join(dataDir, "market.db");
  if (fs.existsSync(VENV_PYTHON)) process.env.FETCH_PYTHON_BIN = VENV_PYTHON;
  process.chdir(bundledRoot()); // fetch 的 PROJECT_ROOT=process.cwd() 命中 scripts/
}

/** 启动 next 生产服务器 (utilityProcess.fork, 无 Dock 图标), 返回随机可用端口 */
function startNextServer() {
  return new Promise((resolve, reject) => {
    const cli = path.join(app.getAppPath(), "node_modules", "next", "dist", "bin", "next");
    let attempts = 0;
    const tryPort = (port) => {
      if (attempts > 10) return reject(new Error("未找到可用端口"));
      attempts += 1;
      const child = utilityProcess.fork(
        cli,
        ["start", "-H", "127.0.0.1", "-p", String(port)],
        {
          cwd: app.getAppPath(),
          env: { ...process.env },
          stdio: "pipe",
        },
      );
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
        if (!settled && /Local:|Ready/.test(logs)) {
          settled = true;
          // Ready 打印 ≠ HTTP 可服务 (冷启动时序), 轮询端口就绪再 resolve; 超时视为失败
          const ok = await waitUntilReachable(Date.now() + 20000);
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
        if (!settled) {
          // 端口被占用 (EADDRINUSE) 等非零退出 → 试下一个端口
          if (code !== null) tryPort(port + 1);
          else reject(new Error("next start 启动失败"));
        }
      });
      child.on("error", (e) => {
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
    const dataDir = initDataDir();
    applyDesktopEnv(dataDir);
    const port = await startNextServer();
    const win = new BrowserWindow({
      width: 1440,
      height: 960,
      title: APP_TITLE,
      autoHideMenuBar: true,
      // webviewTag: 桌面版榜单以 <webview> 内嵌第三方官网 (spec 013, AC-A)
      webPreferences: { contextIsolation: true, nodeIntegration: false, webviewTag: true },
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
