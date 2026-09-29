// Spec: 016-nav-modules — normalizeUrl 归一化单测 (spec 006 契约即测试)

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl } from "./url-utils";

test("normalizeUrl 空串/纯空白无效", () => {
  assert.equal(normalizeUrl(""), null);
  assert.equal(normalizeUrl("   "), null);
});

test("normalizeUrl 无协议自动补 https://", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com/");
  assert.equal(normalizeUrl("www.example.com/path?a=1"), "https://www.example.com/path?a=1");
});

test("normalizeUrl 已有 http/https 协议原样保留", () => {
  assert.equal(normalizeUrl("http://example.com"), "http://example.com/");
  assert.equal(normalizeUrl("https://example.com/x"), "https://example.com/x");
});

test("normalizeUrl 前后空白去除", () => {
  assert.equal(normalizeUrl("  https://example.com  "), "https://example.com/");
});

test("normalizeUrl 非法输入无效 (无 host / 乱码)", () => {
  assert.equal(normalizeUrl("https://"), null);
  assert.equal(normalizeUrl("not a url"), null);
  assert.equal(normalizeUrl("ht!tp://bad"), null);
});
