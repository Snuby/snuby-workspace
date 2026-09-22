// Spec: 010-ai-vc-watch — 创投用例集成测试 (spec 007: 临时库 fixture, 绝不触碰 data/vc.db)
// 契约边界: 事件流倒序/过滤/分页; stats 聚合 (未披露不计金额); 人工录入校验 (合法/非法日期/空公司/重复 URL 409)

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { DealEvent } from "@/domain/vc";
import {
  createManualDeal,
  getDealStream,
  getVcFreshness,
  getVcOverview,
  getVcStats,
} from "@/application/vc-service";
import { upsertDealEvent } from "@/infrastructure/sqlite-vc-repository";

let tmpDir: string;

/** 相对当前日期的防腐化生成: daysAgo=0 今天, daysAgo=1 昨天 */
function daysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** 指定月偏移与日的日期 (月偏移 0 = 当月, -1 = 上月) */
function monthDate(monthOffset: number, day: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day));
  return d.toISOString().slice(0, 10);
}

function event(over: Partial<DealEvent>): DealEvent {
  return {
    id: `manual:${over.sourceId ?? Math.random().toString(36).slice(2)}`,
    company: "测试公司",
    round: "A",
    amount: 1e7,
    currency: "USD",
    amountUsd: 1e7,
    announcedAt: daysAgo(1),
    sector: "ai-infra",
    source: "manual",
    sourceId: `id-${Math.random().toString(36).slice(2)}`,
    title: "测试事件",
    url: null,
    notes: null,
    ...over,
  };
}

async function seed(...rows: Partial<DealEvent>[]) {
  for (const r of rows) await upsertDealEvent(event(r));
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "vc-test-"));
  process.env.VC_DB_PATH = path.join(tmpDir, "vc.db");
});

afterEach(() => {
  delete process.env.VC_DB_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("空库降级", () => {
  it("事件流返回空, 不抛错", async () => {
    const stream = await getDealStream({ limit: 50, offset: 0 });
    assert.equal(stream.total, 0);
    assert.deepEqual(stream.deals, []);
  });

  it("overview 标记滞后 (无数据 = 未更新)", async () => {
    const overview = await getVcOverview();
    assert.equal(overview.count, 0);
    assert.equal(overview.stale, true);
  });
});

describe("事件流 — 倒序 / 过滤 / 分页", () => {
  beforeEach(async () => {
    await seed(
      { sourceId: "a", company: "Alpha", announcedAt: daysAgo(1), sector: "ai-infra", source: "techcrunch" },
      { sourceId: "b", company: "Beta", announcedAt: daysAgo(3), sector: "agents", source: "hn" },
      { sourceId: "c", company: "Gamma", announcedAt: daysAgo(5), sector: "ai-infra", source: "manual" },
    );
  });

  it("按 announced_at 倒序", async () => {
    const stream = await getDealStream({ limit: 50, offset: 0 });
    assert.equal(stream.total, 3);
    assert.deepEqual(
      stream.deals.map((d) => d.company),
      ["Alpha", "Beta", "Gamma"],
    );
  });

  it("sector 过滤", async () => {
    const stream = await getDealStream({ limit: 50, offset: 0, sector: "ai-infra" });
    assert.deepEqual(
      stream.deals.map((d) => d.company).sort(),
      ["Alpha", "Gamma"],
    );
  });

  it("source 过滤", async () => {
    const stream = await getDealStream({ limit: 50, offset: 0, source: "hn" });
    assert.deepEqual(stream.deals.map((d) => d.company), ["Beta"]);
  });

  it("分页 limit/offset", async () => {
    const page1 = await getDealStream({ limit: 2, offset: 0 });
    assert.equal(page1.deals.length, 2);
    assert.equal(page1.total, 3);
    const page2 = await getDealStream({ limit: 2, offset: 2 });
    assert.equal(page2.deals.length, 1);
    assert.equal(page2.deals[0].company, "Gamma");
  });
});

describe("stats 聚合 — 未披露不计金额", () => {
  beforeEach(async () => {
    await seed(
      {
        sourceId: "m1",
        announcedAt: monthDate(-1, 15),
        sector: "ai-infra",
        amount: 1e7,
        currency: "USD",
        amountUsd: 1e7,
      },
      {
        sourceId: "m2",
        announcedAt: monthDate(0, 5),
        sector: "ai-infra",
        amount: null,
        currency: null,
        amountUsd: null, // 未披露 → 计入 count, 不计金额
      },
      {
        sourceId: "m3",
        announcedAt: monthDate(0, 8),
        sector: "agents",
        amount: 5e6,
        currency: "USD",
        amountUsd: 5e6,
      },
    );
  });

  it("by=sector: count 含未披露, 金额不含", async () => {
    const stats = await getVcStats("sector");
    const infra = stats.items.find((i) => i.key === "ai-infra");
    assert.ok(infra);
    assert.equal(infra.count, 2);
    assert.equal(infra.amountUsd, 1e7); // 第二条未披露不计入
    const agents = stats.items.find((i) => i.key === "agents");
    assert.equal(agents?.count, 1);
    assert.equal(agents?.amountUsd, 5e6);
  });

  it("by=month: 跨月分组 + 时间升序", async () => {
    const stats = await getVcStats("month");
    assert.equal(stats.items.length, 2);
    assert.equal(stats.items[0].count + stats.items[1].count, 3);
    assert.equal(stats.items[0].amountUsd + stats.items[1].amountUsd, 1.5e7);
    assert.ok(stats.period.includes("至"));
  });

  it("source 过滤作用于聚合", async () => {
    await seed({ sourceId: "x", source: "techcrunch", announcedAt: monthDate(0, 10), sector: "fintech", amountUsd: 3e6 });
    const stats = await getVcStats("sector", { source: "manual" });
    const fintech = stats.items.find((i) => i.key === "fintech");
    assert.equal(fintech, undefined);
  });
});

describe("人工录入校验", () => {
  it("合法录入 → 写入并返回视图 (round 归一化, sector 缺省分类)", async () => {
    const res = await createManualDeal({
      company: " 月球智能 ",
      announcedAt: daysAgo(2),
      round: "Series B",
      amount: 5e7,
      currency: "USD",
      url: "https://example.com/raise-1",
      notes: "AI 芯片公司",
    });
    assert.ok(res.ok);
    if (!res.ok) return;
    assert.equal(res.deal.company, "月球智能");
    assert.equal(res.deal.round, "B");
    assert.equal(res.deal.sector, "ai-infra"); // notes 含「芯片」→ 分类
    assert.equal(res.deal.source, "manual");
    const stream = await getDealStream({ limit: 50, offset: 0 });
    assert.equal(stream.total, 1);
  });

  it("空公司 → validation", async () => {
    const res = await createManualDeal({ company: "  ", announcedAt: daysAgo(1) });
    assert.ok(!res.ok);
    if (res.ok) return;
    assert.equal(res.code, "validation");
    if (res.code === "validation") {
      assert.ok(res.errors.some((e) => e.includes("company")));
    }
  });

  it("未来日期 → validation", async () => {
    const res = await createManualDeal({ company: "X", announcedAt: daysAgo(-1) });
    assert.ok(!res.ok);
    if (res.ok) return;
    assert.equal(res.code, "validation");
    if (res.code === "validation") {
      assert.ok(res.errors.some((e) => e.includes("未来")));
    }
  });

  it("非法日期格式 → validation", async () => {
    const res = await createManualDeal({ company: "X", announcedAt: "2026/09/22" });
    assert.ok(!res.ok);
    if (res.ok) return;
    assert.equal(res.code, "validation");
    if (res.code === "validation") {
      assert.ok(res.errors.some((e) => e.includes("YYYY-MM-DD")));
    }
  });

  it("amount 有值但 currency 缺失 → validation", async () => {
    const res = await createManualDeal({ company: "X", announcedAt: daysAgo(1), amount: 1e6 });
    assert.ok(!res.ok);
    if (res.ok) return;
    assert.equal(res.code, "validation");
    if (res.code === "validation") {
      assert.ok(res.errors.some((e) => e.includes("currency")));
    }
  });

  it("currency 不在枚举 → validation", async () => {
    const res = await createManualDeal({
      company: "X",
      announcedAt: daysAgo(1),
      amount: 1e6,
      currency: "BTC",
    });
    assert.ok(!res.ok);
    if (res.ok) return;
    assert.equal(res.code, "validation");
    if (res.code === "validation") {
      assert.ok(res.errors.some((e) => e.includes("currency")));
    }
  });

  it("同 URL 重复 → duplicate-url; force 后仍可写入 (同链接多轮次)", async () => {
    const url = "https://example.com/round-2";
    const first = await createManualDeal({ company: "X", announcedAt: daysAgo(2), url });
    assert.ok(first.ok);
    const dup = await createManualDeal({ company: "X", announcedAt: daysAgo(1), url });
    assert.ok(!dup.ok);
    if (dup.ok) return;
    assert.equal(dup.code, "duplicate-url");
    assert.equal(dup.duplicateUrl, url);
    const forced = await createManualDeal(
      { company: "X", announcedAt: daysAgo(1), url, round: "C" },
      { force: true },
    );
    assert.ok(forced.ok);
    const stream = await getDealStream({ limit: 50, offset: 0 });
    assert.equal(stream.total, 2);
  });

  it("round 非法值存原文 (不报错)", async () => {
    const res = await createManualDeal({
      company: "X",
      announcedAt: daysAgo(1),
      round: "H轮 (合并)",
    });
    assert.ok(res.ok);
    if (!res.ok) return;
    assert.equal(res.deal.round, "H轮 (合并)");
  });
});

describe("新鲜度", () => {
  it("有数据且 3 天内 → 不滞后; 超过 VC_STALE_DAYS → 滞后", async () => {
    await seed({ sourceId: "f1", announcedAt: daysAgo(1) });
    const fresh = await getVcFreshness();
    assert.equal(fresh.stale, false);
    assert.equal(fresh.count, 1);
    assert.ok(fresh.latestDate);
  });

  it("最新事件在 5 天前 → 滞后", async () => {
    await seed({ sourceId: "f2", announcedAt: daysAgo(5) });
    const fresh = await getVcFreshness();
    assert.equal(fresh.stale, true);
    assert.ok((fresh.lagDays ?? 0) >= 5);
  });
});
