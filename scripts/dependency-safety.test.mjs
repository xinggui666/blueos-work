import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { z } from "zod";
import { serialize, deserialize } from "seroval";
const require = createRequire(import.meta.url);
test("patched Zod still enforces constrained collections", () => {
  assert.equal(z.array(z.string()).max(2).safeParse(["a", "b", "c"]).success, false);
});
test("patched serializer preserves RegExp and typed arrays", () => {
  const v = { pattern: new RegExp("</script>"), array: new Uint8Array([1, 2]) };
  const value = deserialize(serialize(v));
  assert.equal(value.pattern.source, v.pattern.source);
  assert.deepEqual([...value.array], [1, 2]);
});
test("scoped minimatch override preserves estree named API and glob semantics", () => {
  const fromEstree = createRequire(require.resolve("@typescript-eslint/typescript-estree"));
  const { minimatch } = fromEstree("minimatch");
  assert.equal(minimatch("src/.hidden.ts", "src/*.ts", { dot: true }), true);
  assert.equal(minimatch("src/a.js", "src/*.ts", { dot: true }), false);
});
