// Topic/Site 配置层单测 (灵活工作台): 种子幂等 + CRUD + 级联清理
// 库文件隔离: 设置 SITE_TABS_DB_PATH 指向临时目录, 避免污染真实 data/site_tabs.db。
// 注意: repository 是模块级惰性单例, 本文件在 import 前设置 env。

process.env.SITE_TABS_DB_PATH = `${process.env.TMPDIR ?? "/tmp"}/snuby-topics-test-${process.pid}.db`;

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ensureTopicsSeeded,
  listTopics,
  getTopic,
  createTopic,
  renameTopic,
  updateTopicSettings,
  deleteTopic,
  listSites,
  addSite,
  removeSite,
  reorderSites,
} from "./site-tabs-repository";

const DB_PATH = process.env.SITE_TABS_DB_PATH;

after(() => {
  try {
    fs.rmSync(DB_PATH!, { force: true });
  } catch {
    // 忽略
  }
});

test("种子: 首次写入 3 个出厂主题, 幂等", () => {
  ensureTopicsSeeded();
  const first = listTopics();
  assert.equal(first.length, 3);
  assert.ok(first.every((t) => t.isPreset));
  assert.deepEqual(
    first.map((t) => t.name),
    ["IT 资讯", "自媒体", "AI 模型榜单"],
  );
  // 幂等: 再种一次不重复
  ensureTopicsSeeded();
  assert.equal(listTopics().length, 3);
});

test("种子: 出厂主题各带预期站点", () => {
  const itNews = getTopic("it-news");
  assert.ok(itNews);
  const sites = listSites("it-news");
  assert.equal(sites.length, 7);
  assert.equal(sites[0].label, "The Verge");
  assert.equal(sites[6].label, "InfoQ 中文");
  assert.equal(listSites("creators").length, 2);
  assert.equal(listSites("leaderboard").length, 2);
});

test("创建主题: 追加到末尾, isPreset=0", () => {
  const id = createTopic("AI 创投");
  const topics = listTopics();
  assert.equal(topics.at(-1)?.id, id);
  assert.equal(getTopic(id)?.isPreset, false);
  assert.equal(getTopic(id)?.name, "AI 创投");
  deleteTopic(id);
});

test("重命名主题", () => {
  const id = createTopic("旧名");
  renameTopic(id, "新名");
  assert.equal(getTopic(id)?.name, "新名");
  deleteTopic(id);
});

test("主题设置 JSON 持久化", () => {
  const id = createTopic("设置测试");
  updateTopicSettings(id, { maxTabs: 5, maxHistory: 50 });
  assert.deepEqual(getTopic(id)?.settings, { maxTabs: 5, maxHistory: 50 });
  // 传 null 保留旧值
  updateTopicSettings(id, null);
  assert.deepEqual(getTopic(id)?.settings, { maxTabs: 5, maxHistory: 50 });
  deleteTopic(id);
});

test("添加站点: sort 追加, label 缺省回退 url", () => {
  const id = createTopic("站点测试");
  const s1 = addSite(id, "https://a.com", "");
  const s2 = addSite(id, "https://b.com", "B 站");
  const sites = listSites(id);
  assert.equal(sites.length, 2);
  assert.equal(sites[0].id, s1);
  assert.equal(sites[0].label, "https://a.com");
  assert.equal(sites[1].label, "B 站");
  deleteTopic(id);
});

test("移除站点: 级联清理该站点标签", () => {
  const id = createTopic("移除测试");
  const s1 = addSite(id, "https://a.com", "A");
  removeSite(id, s1);
  assert.equal(listSites(id).length, 0);
  deleteTopic(id);
});

test("重排站点: 按数组下标重写 sort", () => {
  const id = createTopic("排序测试");
  const s1 = addSite(id, "https://a.com", "A");
  const s2 = addSite(id, "https://b.com", "B");
  const s3 = addSite(id, "https://c.com", "C");
  reorderSites(id, [s3, s1, s2]);
  assert.deepEqual(
    listSites(id).map((s) => s.id),
    [s3, s1, s2],
  );
  deleteTopic(id);
});

test("删除主题: 级联清 sites", () => {
  const id = createTopic("删除测试");
  addSite(id, "https://a.com", "A");
  deleteTopic(id);
  assert.equal(getTopic(id), null);
  assert.equal(listSites(id).length, 0);
});
