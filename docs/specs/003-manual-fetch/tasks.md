# Tasks — 003 manual-fetch

## A 管道与应用层

- [x] A1 `scripts/fetch_data.py`: 主循环输出 `@@PROGRESS` / `@@DONE` JSON 行（US-2 AC2）
- [x] A2 `src/infrastructure/fetch-runner.ts`: spawn 子进程 + 行解析
- [x] A3 `src/application/fetch-service.ts`: 内存任务状态 + 防重复（US-1 AC1）
- [x] A4 `POST /api/macro/fetch` + `GET /api/macro/fetch/status`

## B 表现层与文档

- [x] B1 `src/components/macro/fetch-button.tsx`: 按钮态/进度条/结果摘要 + 完成后 router.refresh
- [x] B2 `/macro` 数据说明行挂载按钮；设置页文案改为手动触发
- [x] B3 README（管道章节 + 环境变量表）、conventions 术语表、docs/README 规格索引同步
- [x] B4 取消每周一定时任务（automation 已删除）

## C 验收

- [x] C1 `npm run build` 通过
- [x] C2 实测: 启动抓取 → 进度推进 → 运行中重复 POST 返回 409 → 完成后页面数据刷新
- [x] C3 全部 AC 勾选, spec 状态置 done
