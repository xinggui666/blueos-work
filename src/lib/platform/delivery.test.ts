import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareDelivery } from "./delivery.ts";
test("conflict/invalid/no-save receipt prevents all billable calls", async () => {
  for (const result of [
    { ok: false, conflict: true },
    { ok: true, revision: 0 },
    { ok: true },
    { ok: false },
  ]) {
    const calls: string[] = [];
    await assert.rejects(async () => {
      const fixed = await prepareDelivery({}, async (a) => {
        calls.push(a);
        return result;
      });
      calls.push(`export:${fixed.expectedRevision}`);
    });
    assert.deepEqual(calls, ["syncProject"]);
  }
});
test("successful delivery forwards fixed revision and digest, not a fresh latest lookup", async () => {
  assert.deepEqual(
    await prepareDelivery({}, async () => ({ ok: true, revision: 7, contentSha256: "digest" })),
    { expectedRevision: 7, expectedContentSha256: "digest" },
  );
});
