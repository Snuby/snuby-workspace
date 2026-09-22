# Spec 007 — integration-tests（用例层集成测试）

状态: **done**

## 目标

把测试覆盖从 domain 层扩展到 application 层：用真实 SQLite fixture 打通「SQLite → 仓储 → 用例 → 视图模型」链路，验证 spec 001/002/004/005 的组装行为（分组、趋势窗口裁剪、时效标注、告警排序、缺失数据降级、错误路径）。

非目标: 不测 UI 渲染（React 组件/页面）、不启动真实 Python 子进程（`fetch-runner` 的行解析逻辑随 spec 003 已通过真实抓取验收）、不做 E2E 浏览器测试。

## 依赖

- 复用 spec 006 的测试运行方式（`npm test` = `node --test` + `tsx`）。
- 使用 Node 内置 `node:sqlite` 写入临时 fixture，无需额外依赖。
