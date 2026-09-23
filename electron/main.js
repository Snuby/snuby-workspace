// Spec: 012-electron-packaging — Electron 主进程
// next 生产服务器以 ELECTRON_RUN_AS_NODE 子进程运行 (与 Web 版 npm start 同构, 行为可预期);
// 端口从 3310 起递增探测, 避免与开发端口 3300 冲突。
// 数据契约: MACRO_DB_PATH / MARKET_DB_PATH / FETCH_PYTHON_BIN (与 Web 版同组 env),
// fetch 脚本相对 cwd (process.chdir 到资源根, 含 scripts/)。

const { app, BrowserWindow, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const APP_TITLE = "Snuby 工作台";
const VENV_PYTHON = "/Users/suweijie/.workbuddy/binaries/python/envs/default/bin/python";

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

/** 启动 next 生产服务器 (ELECTRON_RUN_AS_NODE 子进程), 返回随机可用端口 */
function startNextServer() {
  return new Promise((resolve, reject) => {
    const cli = path.join(app.getAppPath(), "node_modules", "next", "dist", "bin", "next");
    let attempts = 0;
    const tryPort = (port) => {
      if (attempts > 10) return reject(new Error("未找到可用端口"));
      attempts += 1;
      const child = spawn(
        process.execPath,
        ["--no-warnings", cli, "start", "-H", "127.0.0.1", "-p", String(port)],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          cwd: app.getAppPath(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let settled = false;
      let logs = "";
      child.stdout.on("data", (d) => {
        logs += String(d);
        if (!settled && /Local:|Ready/.test(logs)) {
          settled = true;
          app.on("will-quit", () => child.kill());
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

app.whenReady().then(async () => {
  try {
    const dataDir = initDataDir();
    applyDesktopEnv(dataDir);
    const port = await startNextServer();
    const win = new BrowserWindow({
      width: 1440,
      height: 960,
      title: APP_TITLE,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await win.loadURL(`http://127.0.0.1:${port}/`);
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
