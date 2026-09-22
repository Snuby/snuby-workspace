// Spec: 010-ai-vc-watch — AI 创投领域纯函数单测
// 契约边界见 docs/specs/010-ai-vc-watch/design.md 第五节 (必测边界 1-5)

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  classifySector,
  dealKey,
  formatMoney,
  formatUsd,
  monthKey,
  normalizeRound,
  parseAmount,
  toDealEventView,
  toUsd,
  CURRENCY_TO_USD,
} from "./vc";

describe("parseAmount — 金额解析", () => {
  it("美元符号 + M: $10M → 10_000_000 USD", () => {
    assert.deepEqual(parseAmount("Morphotonics raises $10M to expand"), { amount: 1e7, currency: "USD" });
  });

  it("欧元 + M: €40M → EUR", () => {
    assert.deepEqual(parseAmount("raises €40M in Series B"), { amount: 4e7, currency: "EUR" });
  });

  it("英镑 + B: £1.2B → 1.2e9 GBP", () => {
    const r = parseAmount("£1.2B round");
    assert.ok(r);
    assert.equal(r.amount, 1.2e9);
    assert.equal(r.currency, "GBP");
  });

  it("千分位逗号: $1,000,000 → 1e6", () => {
    assert.deepEqual(parseAmount("raises $1,000,000 seed"), { amount: 1e6, currency: "USD" });
  });

  it("中文: 10亿元 → 1e9 CNY", () => {
    assert.deepEqual(parseAmount("完成10亿元融资"), { amount: 1e9, currency: "CNY" });
  });

  it("中文: 5000万美元 → 5e7 USD", () => {
    assert.deepEqual(parseAmount("获得5000万美元B轮投资"), { amount: 5e7, currency: "USD" });
  });

  it("多金额取首个 (标题优先): $10M and €40M → USD", () => {
    assert.deepEqual(parseAmount("$10M and €40M"), { amount: 1e7, currency: "USD" });
  });

  it("无金额 → null", () => {
    assert.equal(parseAmount("company announces partnership"), null);
  });

  it("空文本 → null", () => {
    assert.equal(parseAmount(""), null);
    assert.equal(parseAmount(null as unknown as string), null);
  });

  it("中文币种词映射: 8000万人民币 → 8e7 CNY", () => {
    assert.deepEqual(parseAmount("融资8000万人民币"), { amount: 8e7, currency: "CNY" });
  });
});

describe("normalizeRound — 轮次归一化", () => {
  it("Series A / series-a / A轮 → A", () => {
    assert.equal(normalizeRound("Series A"), "A");
    assert.equal(normalizeRound("series-a"), "A");
    assert.equal(normalizeRound("A轮"), "A");
  });

  it("seed / 天使轮 → Seed / Angel", () => {
    assert.equal(normalizeRound("seed"), "Seed");
    assert.equal(normalizeRound("天使轮"), "Angel");
  });

  it("Pre-seed → Pre-seed", () => {
    assert.equal(normalizeRound("Pre-seed"), "Pre-seed");
  });

  it("未知 → null", () => {
    assert.equal(normalizeRound("merger"), null);
    assert.equal(normalizeRound(""), null);
  });
});

describe("classifySector — 赛道分类", () => {
  it("AI 基础设施: GPU 云", () => {
    assert.equal(classifySector("CoreWeave raises $1B for GPU cloud compute"), "ai-infra");
  });

  it("大模型: foundation model", () => {
    assert.equal(classifySector("frontier foundation model lab raises $300M"), "foundation-models");
  });

  it("智能体: agent", () => {
    assert.equal(classifySector("autonomous agent startup funding"), "agents");
  });

  it("具身智能: humanoid", () => {
    assert.equal(classifySector("humanoid robot company Series B"), "robotics");
  });

  it("医疗: biotech", () => {
    assert.equal(classifySector("AI biotech drug discovery funding"), "health");
  });

  it("金融: fintech", () => {
    assert.equal(classifySector("AI fintech payment platform"), "fintech");
  });

  it("未命中 → unclassified (不抛错)", () => {
    assert.equal(classifySector("mysterious company raises funds"), "unclassified");
    assert.equal(classifySector(""), "unclassified");
  });
});

describe("toUsd — 近似汇率换算", () => {
  it("USD → 原值", () => {
    assert.equal(toUsd(1e7, "USD"), 1e7);
  });

  it("EUR → ×1.08", () => {
    assert.equal(toUsd(4e7, "EUR"), 4.32e7);
  });

  it("GBP → ×1.27", () => {
    assert.equal(toUsd(1e6, "GBP"), 1.27e6);
  });

  it("CNY → ×0.14", () => {
    assert.equal(toUsd(1e8, "CNY"), 1.4e7);
  });

  it("未支持币种 → null (不猜测)", () => {
    assert.equal(toUsd(1e6, "BTC"), null);
  });

  it("汇率常量表键集完整", () => {
    assert.ok(CURRENCY_TO_USD.USD === 1 && CURRENCY_TO_USD.EUR && CURRENCY_TO_USD.GBP && CURRENCY_TO_USD.CNY);
  });
});

describe("formatUsd — 美元紧凑格式", () => {
  it("null → 未披露", () => {
    assert.equal(formatUsd(null), "未披露");
  });

  it("M 量级: 50_000_000 → $50.0M", () => {
    assert.equal(formatUsd(5e7), "$50.0M");
  });

  it("B 量级: 2_500_000_000 → $2.5B", () => {
    assert.equal(formatUsd(2.5e9), "$2.5B");
  });

  it("K 量级统一为 M: 500_000 → $0.5M", () => {
    assert.equal(formatUsd(5e5), "$0.5M");
  });

  it("完整金额小数保留: 50_500_000 → $50.5M", () => {
    assert.equal(formatUsd(5.05e7), "$50.5M");
  });
});

describe("formatMoney — 原币展示", () => {
  it("CNY 中文单位: 7e7 → ¥7000万", () => {
    assert.equal(formatMoney(7e7, "CNY"), "¥7000万");
  });

  it("CNY 亿: 1.2e8 → ¥1.2亿", () => {
    assert.equal(formatMoney(1.2e8, "CNY"), "¥1.2亿");
  });

  it("EUR: 4e7 → €40M", () => {
    assert.equal(formatMoney(4e7, "EUR"), "€40M");
  });

  it("null → 未披露", () => {
    assert.equal(formatMoney(null, "USD"), "未披露");
  });
});

describe("dealKey / monthKey", () => {
  it("dealKey 拼接 source:id", () => {
    assert.equal(dealKey("techcrunch", "https://x/y"), "techcrunch:https://x/y");
  });

  it("monthKey 截取 YYYY-MM", () => {
    assert.equal(monthKey("2026-09-22"), "2026-09");
    assert.equal(monthKey("2026-01-05"), "2026-01");
  });
});

describe("toDealEventView — 视图映射", () => {
  it("透传字段并折算 amountUsd", () => {
    const view = toDealEventView({
      id: "techcrunch:abc",
      company: "X",
      round: "A",
      amount: 1e7,
      currency: "USD",
      amountUsd: 1e7,
      announcedAt: "2026-09-22",
      sector: "ai-infra",
      source: "techcrunch",
      sourceId: "abc",
      title: "X raises $10M",
      url: "https://x/y",
      notes: null,
    });
    assert.equal(view.id, "techcrunch:abc");
    assert.equal(view.amountUsd, 1e7);
    assert.equal(view.sector, "ai-infra");
  });
});
