import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverUnownedLegacy } from "./legacy-recovery.ts";
import { activateWorkspace } from "./workspace.ts";
import { makeFromTemplate } from "../blueos/model.ts";
function fixture() {
  const p = makeFromTemplate("blank", {
    name: "private old draft",
    appName: "Old",
    packageName: "com.example.old",
    device: "watch-round",
  });
  const raw = JSON.stringify({ state: { projects: [p] }, version: 0 });
  const m = new Map([["blueos-studio-v1", raw]]);
  return {
    p,
    raw,
    m,
    store: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
    },
  };
}
test("legacy recovery never reads owner-tagged account drafts", () => {
  activateWorkspace("https://one.invalid", "B");
  assert.throws(
    () =>
      recoverUnownedLegacy(
        {
          getItem: (k) => {
            if (k === "bw-owner") return "A";
            throw Error("must not read draft");
          },
          setItem() {},
          removeItem() {},
        },
        () => true,
        () => assert.fail(),
      ),
    /归属/,
  );
});
test("legacy recovery requires two confirmations, validates and creates new IDs without deleting raw bytes", () => {
  const f = fixture();
  activateWorkspace("https://one.invalid", "A");
  let calls = 0;
  let id = "";
  assert.equal(
    recoverUnownedLegacy(
      f.store,
      () => {
        calls++;
        return true;
      },
      (p) => {
        assert.equal(p.length, 1);
        id = p[0].id;
        assert.equal(p[0].protocolExtras?.revision, 0);
      },
    ),
    1,
  );
  assert.equal(calls, 2);
  assert.notEqual(id, f.p.id);
  assert.equal(f.store.getItem("blueos-studio-v1"), f.raw);
});
test("legacy recovery cancellation and identity switch cannot commit", () => {
  const f = fixture();
  activateWorkspace("https://one.invalid", "A");
  let calls = 0;
  assert.equal(
    recoverUnownedLegacy(
      f.store,
      () => false,
      () => assert.fail(),
    ),
    0,
  );
  assert.throws(
    () =>
      recoverUnownedLegacy(
        f.store,
        () => {
          if (++calls === 2) activateWorkspace("https://two.invalid", "A");
          return true;
        },
        () => assert.fail(),
      ),
    /切换/,
  );
  assert.equal(f.store.getItem("blueos-studio-v1"), f.raw);
});
test("damaged legacy JSON/schema never commits and bytes remain unchanged", () => {
  const f = fixture();
  activateWorkspace("https://one.invalid", "A");
  for (const raw of ["{broken", JSON.stringify({ state: { projects: [{}] } })]) {
    f.store.setItem("blueos-studio-v1", raw);
    assert.throws(() =>
      recoverUnownedLegacy(
        f.store,
        () => true,
        () => assert.fail(),
      ),
    );
    assert.equal(f.store.getItem("blueos-studio-v1"), raw);
  }
});
