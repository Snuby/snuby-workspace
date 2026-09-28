# WorkBuddy ACP 网关能力验证记录

> 验证对象：WorkBuddy 本地 ACP 网关（127.0.0.1:62823，Electron 进程，cwd=`/Users/suweijie/space/web-projects/OneDockAgentConnector`）
> 验证方式：直连网关 `POST /api/v1/acp/connect` + JSON-RPC over SSE（`initialize` / `session/new` / `session/load` / `session/prompt` / `session/cancel`），每次 case 记录真实响应与会话文件（`~/.workbuddy/projects/<项目>/<sessionId>.jsonl`）归属。
> 初测日期：2026-09-27（上午）
> 复测日期：2026-09-27（19:18–19:29，同一网关 `62823` / pid 75428）
> 用途：Snuby 工作台「本地 Agent」模块的设计依据。**软件层设计与 WorkBuddy 解耦，只按本记录的能力边界适配。**

---

## 一、结论先行（设计必须遵守的边界）

「复测」列：✅ 属实 · ⚠️ 部分属实 / 偶发 · ❌ 本轮未复现 · — 本轮未重跑

| # | 能力 | 实测结论 | 复测 | 对设计的影响 |
|---|---|---|---|---|
| 1 | **会话路由** | `session/prompt` **忽略 sessionId 参数，按网关「活动会话」路由**（最后执行的 new/load 目标） | ✅ | 多会话必须**全局串行**：任何时刻只激活+执行一个会话；绝不并发 prompt |
| 2 | **cwd 参数** | `session/new`、`session/load` 的 `cwd` **完全无效**；模型工作目录固定为网关进程工作区（OneDockAgentConnector）；不按 cwd 建项目 | ✅ | 工作区隔离**不能靠网关**，只能靠**注入约定（workDir=本地会话目录）+ 任务后越界审计** |
| 3 | **并发** | 同连接并发 prompt：**流错乱**（一侧收双份/另一侧空流）、上下文混合风险 | ✅ | **严禁任何形式的并发**；队列必须全局（跨连接）串行 |
| 4 | **取消** | `session/cancel` **会掐断客户端 HTTP 流**；初测称任务后台继续且残流污染后续 prompt（Case F/J）。复测：断流✅；**后台续跑与残流污染均未复现** | ⚠️ | **仍不依赖网关 cancel 的语义保证**。保守策略可保留「吞流等待」；但不宜写成「cancel 必污染」铁律——以全局串行防并发为主因 |
| 5 | **load 恢复** | `session/load` 能切换活动会话、返回 models/modes/configOptions（**result 无 sessionId**，成功判定用「result 存在」）。初测 Case K 称上下文恢复不可靠；**复测串行口令三次全对** | ⚠️ | 成功判定看 result 存在。历史恢复**仍不以 load 为唯一依据**（偶发风险 + 文件归属陷阱）：load 对齐 + **注入约定引导模型读取本地 `messages.jsonl`** 双保险 |
| 6 | **会话文件** | 网关会话日志写入「**当前活动会话**的文件」；携带非活动 sessionId 的 prompt 日志会写到活动会话文件（Case I 复测确认） | ✅ | 序列化下文件归属才正确；本地会话历史以**我们自己的 messages.jsonl 为准**，不读网关文件 |
| 7 | **fs 工具** | 模型可读写任意绝对路径文件 | ✅ | 注入约定 workDir 策略可行；模型能读 messages.jsonl 做历史恢复 |
| 8 | **事件流** | 类型：`session_info_update` / `agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `usage_update` / `config_option_update` | ✅ | 现有解析已覆盖；无额外事件需要处理 |
| 9 | **模型/配置** | `session/set_model`、`session/set_config_option` 有效，result/config 更新可用 | — | 现有实现可用 |
| 10 | **回放** | load/挂载会话时网关向流通道重放历史（需要 GET 订阅消费，现有 drainReplayOn 已处理） | — | 保持 |

### 复测补充观察

- `initialize` 返回 `delegateToolsSupport: true`（硬隔离委派具备协议声明；Snuby 侧尚未启用）。
- 初测 Case A「S1 文件 0B、历史全写入 S2」**表述不准确**：活动=S1 时的「记住苹果」会写入 S1；仅**活动已切到 S2 之后**误带 S1 sessionId 的 prompt 才写入 S2。Case I 复测用标记词证实此模型。

---

## 二、验证 Case 明细

### Case A：prompt 是否按 sessionId 路由
- 步骤：`new S1` → `prompt(S1,"记住口令：苹果")` → `new S2` → `prompt(S2,"记住口令：香蕉")` → `prompt(S1,"刚才的口令？")`
- 初测结果：**答「香蕉」**（S2 的口令）
- **复测（✅）**：同样步骤答「香蕉」。结论不变：**prompt 忽略 sessionId，按活动会话路由**。
- 勘误：初测「S1 的文件 0B（历史全写入 S2）」不成立——S1 在活动期内的记住操作会落在 S1；写入 S2 的是后续误路由的 ask。见 Case I。

### Case B：load 能否恢复上下文
- 步骤（接 Case A）：`load S1` → `prompt(S1,"刚才的口令？")`
- 初测结果：答「没有口令」（当时认为 S1 文件为空）
- **复测**：答「苹果」。与勘误后的文件归属一致（S1 确有首次记住记录）。
- 结论修订：load **能**切换活动会话并恢复该会话文件中已有上下文；初测「答不出」是误判文件为空，不是 load 必然失败。load result 字段 = `models,modes,configOptions`（无 sessionId）——见 Case C。

### Case C：load 成功判定
- result 结构：`{"models":{"availableModels":[...]}, "modes":[...], "configOptions":[...]}`——**无 sessionId**
- **复测（✅）**：keys 同为 `models,modes,configOptions`，无 `sessionId`。
- 结论：成功判定应看「result 对象存在」，不能看 `result.sessionId`（现有代码已按此实现）。

### Case D：cwd 语义
- `new(cwd=/tmp/probe-cwd-d)` 后问 pwd → 答 `/Users/suweijie/space/web-projects/OneDockAgentConnector`；网关项目目录未按 cwd 创建
- **复测（✅）**：`new(cwd=/tmp/acp-probe-cwd-<ts>)` + Bash `pwd` → 仍为 `OneDockAgentConnector`。
- 结论：**cwd 参数完全无效**。

### Case E：事件类型
- 简单 prompt 事件：`session_info_update, agent_message_chunk`；工具型任务另有 `tool_call/tool_call_update`、`usage_update`、`config_option_update`（此前实测）
- **复测（✅）**：简单 prompt 观察到 `session_info_update, agent_message_chunk, usage_update`。
- 结论：现有解析覆盖。

### Case F：session/cancel
- 初测：长任务开始 1.5s 后 `session/cancel` → 客户端流中断；并结合 Case G 推断任务后台继续。
- **复测（⚠️）**：
  - 断客户端流：✅（`done=false`，客户端收不到后续）
  - 后台续跑：❌ 未证实——cancel 后等待 45s，对应 `.jsonl` 体积无增长；在已有流式输出（~94 字）后再 cancel，下一会话短 prompt 也未混入长文。
- 结论修订：**cancel 会断客户端流**；「任务必定后台继续」降级为初测观察 / 本轮未复现，不再作铁律。

### Case G：同连接并发
- 初测：并发 prompt → 一流收到长文残片、另一流空；口令上下文混合。
- **复测（✅）**：`prompt(G1 记住桃子)` ∥ `prompt(G2 记住李子)` → G1 流为「已记住已记住」（len=6），G2 流为空（len=0）。
- 结论：并发下流错乱**仍成立**，**完全不可用**。

### Case H：fs 能力
- 初测：读 `/etc/hostname` → 模型解释 macOS 无此文件（工具可用）。
- **复测（✅）**：读 `/tmp/acp-fs-probe.txt`（内容 `ACP_FS_PROBE_OK_42`）→ 模型原样返回探针内容。
- 结论：**fs 读写工具可用**（模型可操作任意绝对路径）。

### Case I：load 后文件归属
- 步骤：`new I1` → `new I2` → `prompt(I1, 标记词1)` → 检查文件；`load I1` → `prompt(I1, 标记词2)` → 再检查。
- **复测（✅）**：活动=I2 时 `prompt(I1)` → 标记词1 **仅在 I2 文件**（I1 文件 0B）；`load I1` 后 `prompt(I1)` → 标记词2 **仅在 I1 文件**。
- 结论：日志写入**活动会话**文件；load 能切活动会话使后续归属正确。

### Case J：取消残流隔离
- 初测：长任务 cancel 后立即 `new J2` + prompt → J2 流混入 J1 文章。
- **复测（❌ 未复现）**：待 J1b 已输出 ≥80 字后 cancel + abort，立即 `new J2` +「只回复：就绪」→ J2 干净返回「就绪」（len=2），无长文污染。
- 结论修订：残流污染**曾实测出现，本轮未稳定复现**。设计上仍避免 cancel 后立刻并发/抢跑；主防线是全局串行，而非假定「必污染」。

### Case K：完全串行 + load 对齐
- 初测：串行 A 苹果 / B 香蕉 后，`load A` 口令❌、`load B`✅、再 `load A`❌ → 判 load 不可靠。
- **复测（❌ 未复现该失败模式）**：同样串行步骤 → A1=苹果、B=香蕉、A2=苹果，**三次全对**。
- 结论修订：load 在串行对齐下**可以**恢复上下文；初测失败作偶发/时序风险保留。历史仍以本地 `messages.jsonl` + 注入约定为主（兼防 Case I 文件写错会话）。

---

## 三、对 Snuby「本地 Agent」模块的设计约束（正式生效）

1. **全局串行执行队列（跨连接）**：任何时刻仅 1 个本地会话被「对齐 + 执行」；其余排队（干等，可手动取消排队项）。排队中的任务轮到时若已被取消，直接跳过并上报。（复测仍强制：#1 路由 + #3 并发）
2. **每次任务前 load 目标网关会话**（尽力对齐活动会话）；**load 结果不作成功与否的唯一依据**（成功 = result 存在；上下文恢复偶发失败时靠本地历史）。
3. **历史恢复以本地为准**：prompt 时若本地会话已有历史，注入引导「先读取 `<会话目录>/messages.jsonl` 了解历史再继续」；网关 load 只是补充。
4. **工作区隔离靠约定 + 审计**：注入约定明确 workDir=本地会话目录；任务结束后审计产物是否越界。（#2 cwd 无效仍成立）
5. **取消/超时策略（保守）**：不依赖网关 cancel 语义。用户取消/超时后，服务端可继续消费网关流但不转发前端（吞流），再放行队列——作为防御性实现保留；**复测未证明「不吞流必串台」**，主因仍是禁止并发。前端「停止」为本地展示停止。
6. **不并发**；队列阻塞是可接受的干等（用户已确认）。
7. 单连接即可（per-session 连接池为无效复杂度）；`conns` 保留 default 单键即可。
8. **（观察）** `delegateToolsSupport: true` 已出现在 initialize；硬隔离（工具委派 + realpath 白名单）可作后续迭代，不在本记录强制范围内。

---

## 四、复测原始摘要（2026-09-27 晚）

| Case | 结果 | 要点 |
|---|---|---|
| A | ✅ | `prompt(S1)` 活动=S2 时答「香蕉」 |
| B | 勘误 | load S1 后答「苹果」（S1 确有首次记住） |
| C | ✅ | load result keys=`models,modes,configOptions` |
| D | ✅ | pwd=`…/OneDockAgentConnector` |
| E | ✅ | `session_info_update, agent_message_chunk, usage_update` |
| F | ⚠️ | 断流✅；jsonl 45s 无增长 |
| G | ✅ | G1=「已记住已记住」、G2 空流 |
| H | ✅ | 读到 `/tmp` 探针内容 |
| I | ✅ | 误 sessionId → 写入活动会话文件 |
| J | ❌ | cancel 后 J2=「就绪」，无污染 |
| K | ❌ | 串行口令三次全对 |

复测脚本与日志（本机临时，不入库）：`/tmp/acp-verify/verify.mjs`、`phase1.log`、`phase2.log`、`retest-fj.json`、`case-i.json`。

---

## 五、探测遗留与待清理

- 网关侧孤儿会话文件（`~/.workbuddy/projects/Users-suweijie-space-web-projects-OneDockAgentConnector/` 下探测/复测产生）：初测批次 `1dc8569e`、`20ad993d`、… 以及复测批次 `8592af4c`、`91524efe`、`c1d766d6`、`f9e9ec70`、`653dcaaa`、`b1618663`、`4eca6025` 等。
- 本地内容污染文件：历史探测产物（verify-q1/q2、verify-a/b、verify-seq、concurrency-test-a 等）随 017 收尾清理。
