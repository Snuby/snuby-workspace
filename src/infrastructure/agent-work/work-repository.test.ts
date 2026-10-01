process.env.AGENT_WORKS_PATH = `${process.env.TMPDIR ?? "/tmp"}/snuby-works-test-${process.pid}`;

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getWorksRoot,
  createWork,
  getWork,
  listWorks,
  deleteWork,
  createLibraryFolder,
  moveWorkToFolder,
  readLibrary,
  currentContentPath,
} from "./work-repository";

after(() => {
  try {
    fs.rmSync(getWorksRoot(), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("createWork 骨架与 library 挂载", () => {
  const w = createWork({ title: "测试文章" });
  assert.ok(w.id.startsWith("w_"));
  assert.equal(w.title, "测试文章");
  assert.ok(w.currentDraftId);

  const dir = path.join(getWorksRoot(), w.id);
  assert.ok(fs.existsSync(path.join(dir, "meta.json")));
  assert.ok(fs.existsSync(path.join(dir, "drafts", w.currentDraftId, "content.md")));
  assert.ok(fs.existsSync(path.join(dir, "drafts", "drafts-branches.json")));
  assert.ok(fs.existsSync(path.join(dir, "resources", "resources.json")));
  assert.ok(fs.existsSync(path.join(dir, "collab", "draft", "messages.jsonl")));
  assert.ok(fs.existsSync(path.join(dir, "artifacts")));
  assert.ok(fs.existsSync(path.join(dir, "publish")));

  const lib = readLibrary();
  assert.ok(lib.rootWorkIds.includes(w.id));

  const again = getWork(w.id);
  assert.equal(again?.title, "测试文章");
  assert.ok(listWorks().some((x) => x.id === w.id));
  assert.ok(currentContentPath(w.id)?.endsWith("content.md"));
});

test("文件夹创建与移动作品", () => {
  const folder = createLibraryFolder("专栏A");
  const w = createWork({ title: "篇目", folderId: folder.id });
  let lib = readLibrary();
  const f = lib.folders.find((x) => x.id === folder.id);
  assert.ok(f?.workIds.includes(w.id));
  assert.equal(getWork(w.id)?.folderId, folder.id);

  moveWorkToFolder(w.id, null);
  lib = readLibrary();
  assert.ok(lib.rootWorkIds.includes(w.id));
  assert.equal(getWork(w.id)?.folderId, null);
});

test("deleteWork 清目录与 library", () => {
  const w = createWork({ title: "待删" });
  assert.equal(deleteWork(w.id), true);
  assert.equal(getWork(w.id), null);
  assert.ok(!readLibrary().rootWorkIds.includes(w.id));
  assert.ok(!fs.existsSync(path.join(getWorksRoot(), w.id)));
});
