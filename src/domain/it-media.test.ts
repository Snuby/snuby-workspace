// Spec: 016-nav-modules — it-media 内置集 + 合并逻辑单测 (spec 006 契约即测试)

import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_IT_MEDIA, mergeMedia, type MediaItem } from "./it-media";

test("it-media 内置集包含定案的 7 家媒体", () => {
  assert.equal(BUILTIN_IT_MEDIA.length, 7);
});

test("it-media 内置集 slug 唯一且字段齐全", () => {
  const slugs = new Set(BUILTIN_IT_MEDIA.map((m) => m.slug));
  assert.equal(slugs.size, BUILTIN_IT_MEDIA.length);
  for (const m of BUILTIN_IT_MEDIA) {
    assert.ok(m.label.length > 0);
    assert.ok(m.url.startsWith("https://"));
    assert.equal(m.builtin, true);
  }
});

test("it-media 中文媒体站标记 embed=false (实测反 iframe: 量子位跳顶层/新智元/InfoQ 拦截)", () => {
  const chinese = BUILTIN_IT_MEDIA.filter((m) => m.embed === false);
  assert.deepEqual(
    chinese.map((m) => m.slug).sort(),
    ["aiera", "infoq-cn", "jiqizhixin", "qbitai"],
  );
  // 英文站不设 embed → 默认可内嵌
  const embeddable = BUILTIN_IT_MEDIA.filter((m) => m.embed !== false);
  assert.deepEqual(
    embeddable.map((m) => m.slug).sort(),
    ["ars-technica", "mit-tech-review", "the-verge"],
  );
});

test("mergeMedia 内置在前, 自定义追加", () => {
  const custom: MediaItem[] = [
    { slug: "custom-1", label: "我的博客", url: "https://blog.example.com" },
  ];
  const merged = mergeMedia(BUILTIN_IT_MEDIA, custom);
  assert.equal(merged.length, BUILTIN_IT_MEDIA.length + 1);
  assert.equal(merged[0].slug, BUILTIN_IT_MEDIA[0].slug);
  assert.equal(merged[merged.length - 1].slug, "custom-1");
});

test("mergeMedia 自定义撞内置 slug 时丢弃自定义项", () => {
  const clash: MediaItem[] = [
    { slug: "the-verge", label: "撞名", url: "https://evil.example.com" },
  ];
  const merged = mergeMedia(BUILTIN_IT_MEDIA, clash);
  assert.equal(merged.length, BUILTIN_IT_MEDIA.length);
  assert.ok(!merged.some((m) => m.label === "撞名"));
});

test("mergeMedia 自定义互相重复 slug 时去重", () => {
  const dup: MediaItem[] = [
    { slug: "custom-x", label: "A", url: "https://a.example.com" },
    { slug: "custom-x", label: "B", url: "https://b.example.com" },
  ];
  const merged = mergeMedia([], dup);
  assert.equal(merged.length, 1);
});

test("mergeMedia 空自定义返回内置全集", () => {
  assert.deepEqual(mergeMedia(BUILTIN_IT_MEDIA, []), [...BUILTIN_IT_MEDIA]);
});
