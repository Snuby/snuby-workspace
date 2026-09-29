# Spec 012 — 任务

## A. 基础

- [x] A1 spec 四件套（本目录）
- [x] A2 `npm i -D electron electron-builder`

## B. 主进程与配置

- [x] B1 `electron/main.js`：数据初始化（模板复制/env/chdir）+ next server（ELECTRON_RUN_AS_NODE 子进程，3310+ 探测端口）+ BrowserWindow + 退出清理 + 单实例锁
- [x] B2 `package.json`：`main`、`desktop`/`dist` scripts
- [x] B3 `electron-builder.yml`：files / asar:false / extraResources / mac(target, identity:null)
- [x] B4 `build/icon.svg` → `icon.icns` + `icon.png`（qlmanage + sips + iconutil）

## C. 验证

- [x] C1 `npm test` 106 例全绿（AC-E）
- [x] C2 `npm run build` 通过（AC-E）
- [x] C3 `npx electron .` 窗口打开、标题「Snuby 工作台」、首页与四板块可访问（AC-B）
- [x] C4 `npm run dist` 产出 dmg 与 .app（AC-A）
- [x] C5 启动打包产物：页面复检 + userData 数据存在 + 3300 未被占用 + 退出无残留（AC-B/C/D）

## D. 收尾

- [x] D1 docs/README.md 规格索引补 012；根 README 补桌面使用说明
- [x] D2 git 提交 feat/012-electron-packaging（不含他人未提交 3 文件）
