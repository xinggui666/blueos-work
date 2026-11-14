import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { parse } = createRequire(require.resolve("eslint"))("espree"),
  source = readFileSync("android-web/public/boot.js", "utf8"),
  html = readFileSync("android-web/index.html", "utf8");
test("standalone watchdog really parses as ES5 without module support", () =>
  assert.doesNotThrow(() => parse(source, { ecmaVersion: 5, sourceType: "script" })));
test("static boot recovery exists even before JavaScript or modules execute", () => {
  assert.match(html, /id="bw-boot"/);
  assert.match(html, /id="bw-boot-retry"[^>]+href=/);
  assert.ok(html.indexOf('src="./boot.js"') < html.indexOf('src="./main.tsx"'));
});
test("standalone watchdog never reads or clears account draft storage", () =>
  assert.doesNotMatch(source, /localStorage|sessionStorage|clearData|clearStorage/));
