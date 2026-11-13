import { test } from "node:test";
import assert from "node:assert/strict";
import { swapUserStorage, OWNER_KEY } from "./storage.ts";

function mem() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test("首次登录：本机已有数据归当前账号", () => {
  const s = mem();
  s.setItem("blueos-studio-v1", "A-data");
  assert.equal(swapUserStorage(s, "A"), "adopted");
  assert.equal(s.getItem("blueos-studio-v1"), "A-data");
  assert.equal(s.getItem(OWNER_KEY), "A");
  assert.equal(swapUserStorage(s, "A"), "same");
});

test("换账号：A 的数据收起来不丢，B 看不到；换回 A 原样恢复", () => {
  const s = mem();
  swapUserStorage(s, "A");
  s.setItem("blueos-studio-v1", "A-projects");
  s.setItem("blueos-sync-state-v2", "A-marks");
  assert.equal(swapUserStorage(s, "B"), "swapped");
  assert.equal(s.getItem("blueos-studio-v1"), null);
  assert.equal(s.getItem("blueos-sync-state-v2"), null);
  s.setItem("blueos-studio-v1", "B-projects");
  swapUserStorage(s, "A");
  assert.equal(s.getItem("blueos-studio-v1"), "A-projects");
  assert.equal(s.getItem("blueos-sync-state-v2"), "A-marks");
  assert.equal(s.getItem("bw:B:blueos-studio-v1"), "B-projects");
  assert.equal(s.getItem("bw:A:blueos-studio-v1"), null);
});
