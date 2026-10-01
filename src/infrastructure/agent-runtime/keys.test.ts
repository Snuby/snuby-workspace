import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTaskKey,
  parseTaskKey,
  isTaskKey,
  normalizeQueueKey,
  legacySessionIdOf,
  workIdOf,
} from "./keys";
import { resolveAlignReason, isFullPreload, needsHistorySnippet } from "./align-reason";

test("format/parse TaskKey", () => {
  const k = formatTaskKey("work", "abc");
  assert.equal(k, "task:work:abc");
  assert.deepEqual(parseTaskKey(k), { kind: "work", id: "abc" });
  assert.equal(isTaskKey(k), true);
  assert.equal(isTaskKey("abc"), false);
});

test("normalizeQueueKey 裸 id → local-session", () => {
  assert.equal(normalizeQueueKey("sid1"), "task:local-session:sid1");
  assert.equal(normalizeQueueKey("task:work:w1"), "task:work:w1");
});

test("legacySessionIdOf / workIdOf", () => {
  assert.equal(legacySessionIdOf("task:local-session:s1"), "s1");
  assert.equal(legacySessionIdOf("s1"), "s1");
  assert.equal(legacySessionIdOf("task:work:w1"), null);
  assert.equal(workIdOf("task:work:w1"), "w1");
  assert.equal(workIdOf("task:local-session:s1"), null);
});

test("resolveAlignReason 优先级", () => {
  assert.equal(
    resolveAlignReason({
      bindingMissing: true,
      gatewayRecreated: true,
      switchedTask: true,
      conventionChanged: true,
      preloadFailed: true,
      firstAlignMarker: false,
    }),
    "gateway_recreated",
  );
  assert.equal(
    resolveAlignReason({
      bindingMissing: true,
      gatewayRecreated: false,
      switchedTask: false,
      conventionChanged: false,
      preloadFailed: false,
      firstAlignMarker: false,
    }),
    "first_run",
  );
  assert.equal(
    resolveAlignReason({
      bindingMissing: false,
      gatewayRecreated: false,
      switchedTask: true,
      conventionChanged: true,
      preloadFailed: false,
      firstAlignMarker: false,
    }),
    "switched_task",
  );
  assert.equal(
    resolveAlignReason({
      bindingMissing: false,
      gatewayRecreated: false,
      switchedTask: false,
      conventionChanged: false,
      preloadFailed: false,
      firstAlignMarker: false,
    }),
    "same_task_continue",
  );
});

test("scope 变化不改变 isFullPreload(same_task)", () => {
  assert.equal(isFullPreload("same_task_continue"), false);
  assert.equal(isFullPreload("switched_task"), true);
  assert.equal(needsHistorySnippet("same_task_continue", true), true);
});
