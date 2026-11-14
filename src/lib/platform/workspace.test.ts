import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activateWorkspace,
  scopedStorage,
  scopedKey,
  workspace,
  isCurrent,
  rememberDeletion,
  deletedProjects,
} from "./workspace.ts";
function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    map,
  };
}
test("origin/account isolation, offline drafts and restart; legacy cache not silently adopted", () => {
  const raw = memory(),
    store = scopedStorage(raw);
  raw.setItem("blueos-studio-v1", "unowned legacy draft");
  activateWorkspace("https://one.invalid/path", "A");
  store.setItem("projects", "A-offline");
  rememberDeletion(raw, "A-deleted");
  const old = workspace();
  activateWorkspace("https://one.invalid", "B");
  assert.equal(store.getItem("projects"), null);
  assert.deepEqual(deletedProjects(raw), []);
  store.setItem("projects", "B-only");
  assert.equal(isCurrent(old), false);
  activateWorkspace("https://two.invalid", "A");
  assert.equal(store.getItem("projects"), null);
  activateWorkspace("https://one.invalid", null);
  assert.equal(store.getItem("projects"), null);
  store.setItem("projects", "must-not-write");
  activateWorkspace("https://one.invalid", "A");
  assert.equal(store.getItem("projects"), "A-offline");
  assert.deepEqual(deletedProjects(raw), ["A-deleted"]);
  assert.equal(raw.getItem("blueos-studio-v1"), "unowned legacy draft");
  assert.ok(scopedKey("projects")?.includes("https%3A%2F%2Fone.invalid"));
});
