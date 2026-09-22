# Requirements — 003 manual-fetch

## 背景

原每周一 09:00 的定时抓取任务由用户取消，数据更新改为在「国家经济数据」页主动触发。

## 用户故事

### US-1 主动触发

作为用户，我在 `/macro` 页数据说明行点击「更新数据」按钮启动抓取。

- [x] AC1: `POST /api/macro/fetch` 启动抓取子进程；已有任务在跑时返回 **409**，不产生第二个进程。
- [x] AC2: 按钮点击后立即进入运行态（禁用 + 进度显示），重复点击无效。
- [x] AC3: 抓取脚本执行 `scripts/fetch_data.py`，幂等写入同一 SQLite，页面无需重新构建即可读到新数据。

### US-2 进度可见

作为用户，我能看到抓取进行到哪一步、结果如何。

- [x] AC1: 页面每 ~1.2s 轮询 `GET /api/macro/fetch/status`，显示「抓取中 n/总数」与进度条。
- [x] AC2: `scripts/fetch_data.py` 每完成一个指标输出一行机器可读进度（`@@PROGRESS {...}` JSON），全部完成后输出 `@@DONE {...}` 汇总；Node 侧流式解析进内存任务状态。
- [x] AC3: 完成后按钮恢复可用，页面自动刷新数据（`router.refresh()`），展示结果摘要（成功 x / 失败 y，失败列指标名）；个别指标失败不算错误。
- [x] AC4: 刷新页面回来后，若任务仍在运行，进度显示可恢复（挂载时先查询一次状态）。

### US-3 API 契约

- [x] AC1: `POST /api/macro/fetch` 返回 `{ started, state }`；运行中返回 409 + 当前 `state`。
- [x] AC2: `GET /api/macro/fetch/status` 返回 `FetchJobState`（status/startedAt/finishedAt/done/total/current/summary/error）。
