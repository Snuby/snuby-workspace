# Design — 003 manual-fetch

## 数据流

```
FetchButton (client)  ──POST /api/macro/fetch──▶  application/fetch-service (内存单例任务态)
      │                                                      │ startFetch()
      │                                                      ▼
      │                                        infrastructure/fetch-runner
      │                                          spawn(python -u scripts/fetch_data.py)
      │                                                      │ stdout: @@PROGRESS / @@DONE JSON 行
      │                                                      ▼
      └──GET /api/macro/fetch/status (1.2s 轮询)──── 任务态更新 (进度/当前指标/结果摘要)
                                                             │ 完成后
                                                             ▼
                                                   router.refresh() 重新读取 SQLite
```

## 决策记录

1. **任务状态存 Node 进程内存**（模块级单例）。本地单用户应用无需持久化；重启服务状态回到 idle，但已启动的 Python 子进程会继续跑完入库，数据不丢。
2. **防重复双保险**：服务端 `status === "running"` 拦截并返回 409（幂等语义明确）；前端按钮运行态禁用 + 重复点击直接忽略。刷新页面后靠挂载时查询状态恢复。
3. **进度用行协议而非日志解析**：脚本输出 `@@PROGRESS` / `@@DONE` 前缀的 JSON 行，Node 侧按行缓冲解析，与人类可读日志共存、互不干扰；`spawn` 需配合 `python -u` 关闭缓冲，否则进度成批到达。
4. **完成事件去重**：`@@DONE` 行与进程 `close` 事件都可能触发完成回调，服务层用「状态已非 running 则忽略」保证只结算一次。
5. **Python 解释器可配置**：`FETCH_PYTHON_BIN` 环境变量覆盖，默认本地 venv（akshare 已装）。
6. **失败判定**：脚本退出码仅在成功数 < 5 时为 1；个别指标失败（`status: "fail"`）不计为任务失败，只在摘要中列出指标名。

## API 契约

`POST /api/macro/fetch`

```json
// 200
{ "started": true, "state": { "status": "running", "done": 0, "total": 36, "current": null, "summary": null } }
// 409（已有任务运行）
{ "error": "抓取任务正在运行中", "state": { "status": "running", "done": 12, "total": 36, "...": "..." } }
```

`GET /api/macro/fetch/status`

```json
{
  "status": "done", "startedAt": "2026-09-22T06:58:55.686Z", "finishedAt": "2026-09-22T06:59:15.800Z",
  "done": 36, "total": 36, "current": { "key": "construction_index", "name": "建材指数" },
  "summary": { "ok": 36, "empty": 0, "fail": 0, "failures": [] }, "error": null
}
```

## 目录映射（实现 ↔ 规格追溯）

| 实现 | 对应 AC |
|------|---------|
| `src/infrastructure/fetch-runner.ts` | US-2 AC2 |
| `src/application/fetch-service.ts` | US-1 AC1/AC2, US-3 |
| `src/app/api/macro/fetch/route.ts`、`.../status/route.ts` | US-3 AC1/AC2 |
| `src/components/macro/fetch-button.tsx` | US-1 AC2/AC3, US-2 AC1/AC3/AC4 |
| `scripts/fetch_data.py`（`@@PROGRESS` / `@@DONE`） | US-2 AC2 |
