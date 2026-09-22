# 008 — 设计

## 架构决策

### 决策 1：用路由组（Route Group）表达层级，URL 保持不变

三页统一迁入 `src/app/(macro)/` 路由组，由 `(macro)/layout.tsx` 提供共享外壳：

```
src/app/
├── layout.tsx                    # 根布局 (Sidebar + main)
├── page.tsx                      # / 工作台首页
├── settings/page.tsx             # /settings
└── (macro)/                      # ← 路由组, 不出现在 URL 中
    ├── layout.tsx                # 共享外壳: Topbar + 二级菜单 + 滚动容器
    ├── macro/page.tsx            # /macro      国家经济数据
    ├── industry/page.tsx         # /industry   行业观察
    └── alerts/page.tsx           # /alerts     跟踪提醒
```

**理由**：URL 保持 `/macro`、`/industry`、`/alerts` 不变，意味着 spec 001/002/005 已文档化的路由契约、首页三张卡片的链接、告警卡片跳转全部零改动，也没有重定向债务。层级关系由「共享布局」这一代码事实表达，而不是靠 URL 前缀。若改成 `/macro/industry` 这类嵌套路径，收益只是 URL 更好看，代价是 3 处链接改动 + 2 条重定向 + 2 个 spec 的契约回写 —— 不划算。

**代价**：URL 本身看不出层级。可接受，因为侧边栏高亮与顶部 Tab 已经充分表达了层级。

### 决策 2：外壳统一由布局渲染，页面只渲染内容

改动前，三个页面各自重复渲染 `<Topbar>` + `<div className="flex-1 overflow-auto">`，标题还要各写一遍。改动后：

```tsx
// (macro)/layout.tsx  (Server Component)
<>
  <Topbar title="宏观经济" />
  <SectionTabs action={<FetchButton />} />
  <div className="flex flex-1 flex-col overflow-auto">{children}</div>
</>
```

页面返回值收敛为单一内容节点（`<div className="mx-auto max-w-... px-6 py-7">`）。

**收益**：Topbar 与滚动容器从「3 处重复」变为「1 处定义」；二级菜单位置天然一致（US-2 AC2 由结构保证，而非靠约定）；页面 `error.tsx` 触发时布局仍在，顶栏与 Tab 不消失，用户仍可切走（比改动前更好）。

**注意**：外层容器保留 `flex flex-col`，使页面内「数据不可用」态的 `flex-1 items-center justify-center` 继续居中。

### 决策 3：二级菜单为客户端组件，常量表驱动

`src/components/workbench/section-tabs.tsx`（`"use client"`）：

```ts
const SECTION_TABS = [
  { href: "/macro",    label: "国家经济数据" },
  { href: "/industry", label: "行业观察" },
  { href: "/alerts",   label: "跟踪提醒" },
] as const;
```

- 激活判定用 `usePathname()` 精确相等比较（三个路径互不为前缀，无需 `startsWith`）。
- 视觉：下边框行，选中项 `text-accent-deep` + `font-semibold` + 2px 强调色下划线；未选中 `text-ink-muted` hover 变深。复用 `globals.css` 的既有 token，不新增颜色。
- 右侧可选 `action` 插槽（`React.ReactNode`），由布局传入「更新数据」按钮。

**理由**：三页路径互不为前缀，且标签即模块名，用常量表而非嵌套路由元数据，避免为「一层嵌套」引入过度抽象。

### 决策 4：「更新数据」按钮上提到共享头部

`FetchButton` 从 `/macro` 页面上提到 `SectionTabs` 的右侧插槽。

**理由**：该按钮触发的是**整个 36 项指标**的抓取（`scripts/fetch_data.py` 全量），语义上是「宏观经济」这一层级的动作，不属于「国家经济数据」这一个 Tab；只在其中一个 Tab 可见，会导致用户在「行业观察」看到滞后数据时无从下手（原页脚还要写「请先在『国家经济数据』页更新数据」这类跨页指引）。上提后：

- 三个 Tab 均可触发与查看抓取进度；
- 由于 `SectionTabs` 位于布局中，切换 Tab 时组件不卸载，**抓取进度跨 Tab 保持可见**（此前切页会丢失本地状态）。

**对既有 spec 的影响**：spec 003 的 US/AC 描述的是「`/macro` 页右上角」的按钮位置 —— 此处按 SDD「代码与文档冲突 = 冲突即 Bug」处理，在 spec 003 追加变更记录指向本 spec，规格正文不改写历史。

### 决策 5：用例层按「可见范围」三分，而非给一个函数加参数

`src/application/macro-service.ts` 重构为：

```ts
/** 全量看板 — 供 API 与内部复用 */
getMacroDashboard(): Promise<MacroDashboard>          // 9 组 / 36 项
/** 国家经济数据 Tab — spec 008: 排除 industry 分组 */
getNationalDashboard(): Promise<MacroDashboard>       // 8 组 / 26 项
/** 行业观察 Tab — spec 005: 仅 industry 分组 */
getIndustryDashboard(): Promise<MacroDashboard>       // 1 组 / 10 项
```

三者共用一个私有构建函数，按传入的 `IndicatorGroupId[]` 过滤分组；`staleCount` 在同一构建过程内按**可见指标**统计（修正此前 `/macro` 把不可见的 10 项行业滞后计入的问题）。

**理由**：不用 `getMacroDashboard(scope?)` 可选参数 —— 三个调用点语义不同（原始数据接口 / 一个 Tab / 另一个 Tab），具名函数让调用处自解释，且测试可以直接断言 26 与 10 这两个契约数字。`getMacroDashboard` 保留全量，是因为 `GET /api/macro/indicators` 是数据接口而非页面接口，契约不应随页面分层变化（US-3 AC5）。

### 决策 6：侧边栏激活判定支持一对多

`NavLeaf` 增加可选 `match?: readonly string[]`：

```ts
{ href: "/macro", label: "宏观经济", icon: ICONS.chart, match: ["/macro", "/industry", "/alerts"] }
```

激活判定 `match ? match.includes(pathname) : pathname === href`。

**理由**：一级菜单「宏观经济」对应三条路径，而 `href` 只能有一个；用显式匹配列表比前缀推断更可控（避免未来出现 `/macro-xxx` 被误匹配）。

## 术语变更（同步 conventions.md）

| 术语 | 变更 | 说明 |
|---|---|---|
| 数据观察 | **删除** | 原一级菜单分组名，已由「宏观经济」取代 |
| 宏观经济 | **新增** | `Macro Economy`，工作台一级菜单，聚合三个子模块 |
| 二级菜单 | **新增** | Section Tabs，`宏观经济` 下切换三个子模块的顶部导航条 |
| 国家经济数据 | **修订** | 由「数据观察下的模块」改为「宏观经济下的二级菜单项」，范围收窄为 26 项宏观指标 |
| 行业观察 | **新增**（术语表） | `industry` 分组 10 项指标的二级菜单项 |
| 跟踪提醒 | **新增**（术语表） | 规则评估结果的二级菜单项 |

## 文件影响清单

| 文件 | 变更 | 对应 AC |
|---|---|---|
| `src/app/(macro)/layout.tsx` | 新增：共享外壳 | US-2 AC1/AC2 |
| `src/components/workbench/section-tabs.tsx` | 新增：二级菜单 + action 插槽 | US-2 AC1–AC4 |
| `src/components/workbench/sidebar.tsx` | 收敛为三项 + `match` 支持 | US-1 AC1–AC3 |
| `src/app/(macro)/macro/{page,error}.tsx` | 迁入 + 去 Topbar/滚动容器 | US-2, US-3 AC1 |
| `src/app/(macro)/industry/{page,error}.tsx` | 迁入 + 去 Topbar/滚动容器 | US-2, US-3 AC2 |
| `src/app/(macro)/alerts/{page,error}.tsx` | 迁入 + 去 Topbar/滚动容器 + 顶部说明 | US-2, US-4 |
| `src/application/macro-service.ts` | 新增 `getNationalDashboard`，共构建函数 | US-3 AC1/AC4/AC5 |
| `src/application/macro-service.test.ts` | 新增 26/10 分层断言 | AC-A |
| `src/app/page.tsx` | 卡片文案与页面口径对齐 | US-3 AC3 |
| `docs/conventions.md`、`docs/README.md` | 术语表与索引同步 | — |
| `docs/specs/001,002,003,005` | 追加变更记录 | — |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 路由组迁移导致页面 404 | 迁移后逐页 `curl` 断言 200（AC-C）；布局与页面同批提交，不留中间态 |
| 页面内层 `flex-1` 居中态在嵌套 flex 下失效 | 布局外层保留 `flex flex-col`；用「数据不可用」分支实测确认 |
| `error.tsx` 语义变化（层级升高） | `error.tsx` 仍在各子页目录内，仅捕获该子页异常；布局不受影响，属预期改善 |
| 首页卡片计数再次漂移 | 计数由 `getNationalDashboard()` 实际长度渲染，不再硬编码文案数字 |
