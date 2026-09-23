// Spec: 011-ai-leaderboard — or-rankings 聚合纯函数单测 (spec 006 契约即测试)

import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRankings, formatTokens, shortModelName } from "./or-rankings";

test("shortModelName: 去掉日期后缀与重复厂商前缀", () => {
  assert.equal(shortModelName("deepseek/deepseek-v4-flash-20260731"), "deepseek/v4-flash");
  assert.equal(shortModelName("typesafe/jev-1.13-20260917"), "typesafe/jev-1.13");
  assert.equal(shortModelName("xiaomi/mimo-v2.6-pro-20260921"), "xiaomi/mimo-v2.6-pro");
});

test("shortModelName: 无日期后缀 / 无厂商前缀", () => {
  assert.equal(shortModelName("anthropic/claude-opus-5"), "anthropic/claude-opus-5");
  assert.equal(shortModelName("standalone-model"), "standalone-model");
  assert.equal(shortModelName(""), "");
});

test("formatTokens: T / B / M / 小数值", () => {
  assert.equal(formatTokens(18_400_000_000_000), "18.4T");
  assert.equal(formatTokens(1e12), "1.0T");
  assert.equal(formatTokens(6_430_000_000), "6.4B");
  assert.equal(formatTokens(912_094_431), "912.1M");
  assert.equal(formatTokens(123_456), "123456");
  assert.equal(formatTokens(0), "0");
});

test("aggregateRankings: 同 slug 多行求和并降序赋 rank", () => {
  const rows = [
    { date: "2026-09-20 00:00:00", model_permaslug: "a/one", total_completion_tokens: 100, total_prompt_tokens: 900 },
    { date: "2026-09-21 00:00:00", model_permaslug: "a/one", total_completion_tokens: 100, total_prompt_tokens: 900 },
    { date: "2026-09-22 00:00:00", model_permaslug: "b/two", total_completion_tokens: 300, total_prompt_tokens: 300 },
    { date: "2026-09-19 00:00:00", model_permaslug: "c/three", total_completion_tokens: 50, total_prompt_tokens: 50 },
  ];
  const { rows: out, updatedAt } = aggregateRankings(rows);
  assert.equal(updatedAt, "2026-09-22");
  assert.deepEqual(
    out.map((r) => [r.rank, r.slug, r.tokens]),
    [
      [1, "a/one", 2000],
      [2, "b/two", 600],
      [3, "c/three", 100],
    ],
  );
  assert.equal(out[0].name, "a/one");
});

test("aggregateRankings: 空输入 / 无日期 → 空结果与 null", () => {
  assert.deepEqual(aggregateRankings([]), { rows: [], updatedAt: null });
  const { rows, updatedAt } = aggregateRankings([
    { date: "", model_permaslug: "x/y", total_completion_tokens: 1, total_prompt_tokens: 1 },
  ]);
  assert.equal(updatedAt, null);
  assert.equal(rows.length, 1);
});

test("aggregateRankings: 只计 completion + prompt 两字段", () => {
  const { rows } = aggregateRankings([
    { date: "2026-09-22", model_permaslug: "x/y", total_completion_tokens: 7, total_prompt_tokens: 3 },
  ]);
  assert.equal(rows[0].tokens, 10);
});
