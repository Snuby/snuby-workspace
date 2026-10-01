process.env.AGENT_WORKS_PATH = `${process.env.TMPDIR ?? "/tmp"}/snuby-works-svc-${process.pid}`;

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getWorksRoot,
  createWork,
} from "./work-repository";
import {
  saveDraft,
  checkoutDraft,
  getCurrentDraft,
  readBranches,
  sha1Of,
} from "./draft-service";
import {
  addUrlResource,
  updateResourceNote,
  deleteResource,
  classifyByExt,
} from "./resource-service";
import { decideWritePermission } from "./path-policy";
import { buildWorkPreload } from "./work-preload";
import path from "path";

after(() => {
  try {
    fs.rmSync(getWorksRoot(), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("draft save / unchanged / branch / checkout", () => {
  const w = createWork({ title: "稿" });
  const cur = getCurrentDraft(w.id)!;
  const r0 = saveDraft(w.id, cur.content, {
    draftId: cur.draftId,
    contentSha1: cur.contentSha1,
  });
  assert.equal(r0.ok && r0.unchanged, true);

  const r1 = saveDraft(w.id, "# hello\n", {
    draftId: cur.draftId,
    contentSha1: cur.contentSha1,
  });
  assert.ok(r1.ok && !r1.unchanged);
  assert.equal(readBranches(w.id)?.nodes.length, 2);

  const conflict = saveDraft(w.id, "x", {
    draftId: cur.draftId,
    contentSha1: cur.contentSha1,
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "draft_pointer_changed");

  const after = getCurrentDraft(w.id)!;
  const back = checkoutDraft(w.id, cur.draftId);
  assert.ok(back.ok);
  assert.equal(getCurrentDraft(w.id)?.draftId, cur.draftId);

  const fork = saveDraft(w.id, "# fork\n", {
    draftId: cur.draftId,
    contentSha1: sha1Of(getCurrentDraft(w.id)!.content),
  });
  assert.ok(fork.ok && !fork.unchanged);
  if (fork.ok && !fork.unchanged) {
    assert.equal(fork.parentId, cur.draftId);
  }
  void after;
});

test("resources whitelist + revision", () => {
  assert.equal(classifyByExt("a.pdf"), null);
  assert.equal(classifyByExt("a.md"), "document");
  const w = createWork({ title: "资" });
  const a = addUrlResource(w.id, { name: "链", url: "https://example.com" });
  assert.ok(a.ok);
  if (!a.ok) return;
  const bad = updateResourceNote(w.id, a.item.id, "n", 0);
  assert.equal(bad.ok, false);
  const ok = updateResourceNote(w.id, a.item.id, "短结论", a.file.revision);
  assert.ok(ok.ok);
  const del = deleteResource(w.id, a.item.id, ok.ok ? ok.file.revision : undefined);
  assert.ok(del.ok);
});

test("path-policy deny content for general", () => {
  const w = createWork({ title: "权" });
  const contentPath = path.join(getWorksRoot(), w.id, "drafts", w.currentDraftId, "content.md");
  assert.equal(
    decideWritePermission({
      workId: w.id,
      absPath: contentPath,
      currentDraftId: w.currentDraftId,
      capability: "general",
      draftDirty: false,
    }),
    "deny",
  );
  assert.equal(
    decideWritePermission({
      workId: w.id,
      absPath: contentPath,
      currentDraftId: w.currentDraftId,
      capability: "edit-draft",
      draftDirty: true,
    }),
    "deny",
  );
  assert.equal(
    decideWritePermission({
      workId: w.id,
      absPath: contentPath,
      currentDraftId: w.currentDraftId,
      capability: "edit-draft",
      draftDirty: false,
    }),
    "allow",
  );
});

test("preload 不含 content 正文", () => {
  const w = createWork({ title: "预" });
  saveDraft(w.id, "SECRET_BODY_SHOULD_NOT_APPEAR_IN_PRELOAD", {
    draftId: w.currentDraftId,
    contentSha1: sha1Of(""),
  });
  const bundle = buildWorkPreload(w.id, {
    reason: "first_run",
    scope: "draft",
    scopeRef: { scope: "draft" },
    capability: "general",
  });
  assert.ok(bundle);
  assert.equal(bundle!.text.includes("SECRET_BODY_SHOULD_NOT_APPEAR_IN_PRELOAD"), false);
  assert.ok(bundle!.text.includes("currentDraftId") || bundle!.text.includes("正文路径"));
});
