#!/usr/bin/env node
/** Chromium+mock bridge recovery regression, NOT APK/WebView runtime evidence. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { APP_URL, installMockNative } from "./android-mock.mjs";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch();
let pass = 0;
const seed = {
  "bw-owner": "original-owner",
  "blueos-studio-v1": "original-unowned-bytes",
  "bw-workspace-v3:fixture-A:blueos-studio-v1": "draft-A",
  "bw-workspace-v3:fixture-B:blueos-studio-v1": "draft-B",
};
async function setup() {
  const context = await browser.newContext();
  await installMockNative(context, { apiBase: "http://localhost:4020" });
  await context.addInitScript((seed) => {
    for (const [k, v] of Object.entries(seed))
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, seed);
  return { context, page: await context.newPage() };
}
async function preserved(page) {
  assert.deepEqual(
    await page.evaluate(
      (keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])),
      Object.keys(seed),
    ),
    seed,
  );
}
async function step(name, fn) {
  await fn();
  console.log("PASS", name);
  pass++;
}
try {
  await step(
    "missing dynamic app chunk shows versioned error, cancellation preserves page, full retry recovers without deleting either user's drafts",
    async () => {
      const { context, page } = await setup();
      let broken = true;
      await context.route("**/www/assets/app-*.js", (r) =>
        broken ? r.fulfill({ status: 404, body: "fixture missing chunk" }) : r.fallback(),
      );
      await page.goto(APP_URL);
      await page.getByText("BW_BOOT_V1_APP_CHUNK", { exact: true }).waitFor();
      await preserved(page);
      const before = page.url();
      page.once("dialog", (d) => d.dismiss());
      await page.getByRole("link", { name: "保留数据重新载入" }).click();
      assert.equal(page.url(), before);
      broken = false;
      page.once("dialog", (d) => d.accept());
      await page.getByRole("link", { name: "保留数据重新载入" }).click();
      await page.getByRole("button", { name: "登录", exact: true }).first().waitFor();
      await page.waitForFunction(() => document.getElementById("bw-boot").hidden);
      assert.ok(new URL(page.url()).searchParams.has("bw_boot_retry"));
      await preserved(page);
      await context.close();
    },
  );
  await step("entry script 404 stays visible independently of module execution", async () => {
    const { context, page } = await setup();
    await context.route("**/www/assets/index-*.js", (r) =>
      r.fulfill({ status: 404, body: "missing entry" }),
    );
    await page.goto(APP_URL);
    await page.getByText("BW_BOOT_V1_ENTRY_LOAD", { exact: true }).waitFor();
    await preserved(page);
    await context.close();
  });
  await step(
    "entry syntax/runtime failure has sanitized diagnostics without raw error details",
    async () => {
      const { context, page } = await setup();
      await context.route("**/www/assets/index-*.js", (r) =>
        r.fulfill({
          contentType: "text/javascript",
          body: 'throw new Error("PRIVATE_FIXTURE_DETAIL")',
        }),
      );
      await page.goto(APP_URL);
      await page.getByText("BW_BOOT_V1_STARTUP", { exact: true }).waitFor();
      assert.equal(
        (await page.locator("body").innerText()).includes("PRIVATE_FIXTURE_DETAIL"),
        false,
      );
      await preserved(page);
      await context.close();
    },
  );
  await step(
    "invalid native session stops before editor import and recovers explicitly without adopting drafts",
    async () => {
      const { context, page } = await setup();
      await context.addInitScript(() => {
        const original = window.BlueOSNative.session;
        window.BlueOSNative.session = () =>
          localStorage.getItem("fixture-fixed") ? original() : "{";
      });
      await page.goto(APP_URL);
      await page.getByText("BW_BOOT_V1_SESSION", { exact: true }).waitFor();
      await preserved(page);
      await page.evaluate(() => localStorage.setItem("fixture-fixed", "yes"));
      page.once("dialog", (d) => d.accept());
      await page.getByRole("link", { name: "保留数据重新载入" }).click();
      await page.waitForFunction(() => document.getElementById("bw-boot").hidden);
      await preserved(page);
      await context.close();
    },
  );
  await step(
    "15s watchdog does not clear data or prevent a late successful module load",
    async () => {
      const { context, page } = await setup();
      await page.clock.install();
      let held;
      await context.route("**/www/assets/app-*.js", (r) => {
        held = r;
      });
      await page.goto(APP_URL);
      await page.waitForFunction(() => document.getElementById("bw-boot") !== null);
      while (!held) await new Promise((r) => setTimeout(r, 10));
      await page.clock.fastForward(15001);
      await page.getByText("BW_BOOT_V1_TIMEOUT", { exact: true }).waitFor();
      await preserved(page);
      await held.fallback();
      await page.waitForFunction(() => document.getElementById("bw-boot").hidden);
      await context.close();
    },
  );
  await step(
    "even both watchdog and entry missing leave static readable recovery instead of a blank page",
    async () => {
      const { context, page } = await setup();
      await context.route("**/www/boot.js", (r) =>
        r.fulfill({ status: 404, body: "missing watchdog" }),
      );
      await context.route("**/www/assets/index-*.js", (r) =>
        r.fulfill({ status: 404, body: "missing entry" }),
      );
      await page.goto(APP_URL);
      assert.ok((await page.locator("body").innerText()).includes("请勿清除应用数据"));
      await page.getByRole("link", { name: "保留数据重新载入" }).waitFor();
      await preserved(page);
      await context.close();
    },
  );
  await step("React route/effect failure exposes guarded recovery and preserves data", async () => {
    const { context, page } = await setup();
    await context.addInitScript(() => {
      window.BlueOSNative.session = () =>
        JSON.stringify({
          signedIn: true,
          base: "http://localhost:4020",
          user: { id: "render-fixture", name: "fixture", email: "" },
          expired: false,
        });
      window.BlueOSNative.appInfo = () => "{broken";
    });
    await page.goto(APP_URL);
    await page.getByText("BW_BOOT_V1_RENDER", { exact: true }).waitFor();
    await preserved(page);
    await context.close();
  });
  await step(
    "missing required WebView capability fails visibly before importing editor",
    async () => {
      const { context, page } = await setup();
      await context.addInitScript(() => {
        window.structuredClone = undefined;
      });
      await page.goto(APP_URL);
      await page.getByText("BW_BOOT_V1_UNSUPPORTED", { exact: true }).waitFor();
      await preserved(page);
      await context.close();
    },
  );
  await step(
    "new bridge retry capability is invoked without browser navigation or storage deletion",
    async () => {
      const { context, page } = await setup();
      await context.addInitScript(() => {
        window.__reloadCount = 0;
        window.BlueOSNative.reloadBundledApp = () => {
          window.__reloadCount++;
        };
      });
      await context.route("**/www/assets/app-*.js", (r) =>
        r.fulfill({ status: 404, body: "fixture" }),
      );
      await page.goto(APP_URL);
      await page.getByText("BW_BOOT_V1_APP_CHUNK", { exact: true }).waitFor();
      page.once("dialog", (d) => d.accept());
      await page.getByRole("link", { name: "保留数据重新载入" }).click();
      assert.equal(await page.evaluate(() => window.__reloadCount), 1);
      assert.equal(page.url(), APP_URL);
      await preserved(page);
      await context.close();
    },
  );
  const compiled =
    "(function(){var exports={};" +
    ts.transpileModule(await readFile("android-web/bridge.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
    }).outputText +
    ";window.__testBridge=exports;}());";

  await step(
    "bridge calls reject versioned malformed/throwing/timeout errors and late callbacks cannot resolve the next request",
    async () => {
      const { context, page } = await setup();
      await context.route("**/bridge-fixture.html", (r) =>
        r.fulfill({ contentType: "text/html", body: '<script src="./bridge-probe.js"></script>' }),
      );
      await context.route("**/bridge-probe.js", (r) =>
        r.fulfill({ contentType: "text/javascript", body: compiled }),
      );
      await page.goto(new URL("./bridge-fixture.html", APP_URL).href);
      await page.clock.install();
      const thrown = await page.evaluate(async () => {
        window.BlueOSNative.call = () => {
          throw Error("private details");
        };
        try {
          await window.__testBridge.platformCall("me", {});
        } catch (e) {
          return { code: e.code, message: e.message };
        }
      });
      assert.equal(thrown.code, "BW_BRIDGE_V1_CALL");
      assert.equal(thrown.message.includes("private details"), false);
      const malformed = await page.evaluate(async () => {
        window.BlueOSNative.call = (id) => window.__bwNative.resolve(id, "bad", {});
        try {
          await window.__testBridge.platformCall("me", {});
        } catch (e) {
          return e.code;
        }
      });
      assert.equal(malformed, "BW_BRIDGE_V1_RESPONSE");
      const invalidJson = await page.evaluate(async () => {
        window.BlueOSNative.call = (id) => window.__bwNative.resolve(id, 200, "{broken");
        try {
          await window.__testBridge.platformCall("me", {});
        } catch (e) {
          return e.code;
        }
      });
      assert.equal(invalidJson, "BW_BRIDGE_V1_RESPONSE");
      await page.evaluate(() => {
        window.BlueOSNative.call = (id) => {
          window.__oldId = id;
        };
        window.__result = window.__testBridge.platformCall("me", {}).catch((e) => e.code);
      });
      await page.clock.fastForward(60001);
      assert.equal(await page.evaluate(() => window.__result), "BW_BRIDGE_V1_TIMEOUT");
      await page.evaluate(() => {
        window.__settled = false;
        window.BlueOSNative.call = (id) => {
          window.__newId = id;
        };
        window.__next = window.__testBridge.platformCall("me", {}).then((v) => {
          window.__settled = true;
          return v;
        });
        window.__bwNative.resolve(window.__oldId, 200, '{"wrong":true}');
      });
      assert.equal(await page.evaluate(() => window.__settled), false);
      await page.evaluate(() => window.__bwNative.resolve(window.__newId, 200, '{"ok":true}'));
      assert.deepEqual(await page.evaluate(() => window.__next), { ok: true });
      const oldId = await page.evaluate(() => window.__newId);
      await page.reload();
      const newId = await page.evaluate(() => {
        window.BlueOSNative.call = (id) => {
          window.__id = id;
        };
        void window.__testBridge.platformCall("me", {}).catch(() => {});
        return window.__id;
      });
      assert.notEqual(newId.split(":")[1], oldId.split(":")[1]);
      await context.close();
    },
  );
  console.log(
    JSON.stringify({
      pass,
      environment: "Chromium+mock native bridge, built bundled assets/source bridge",
      apkRuntime: false,
    }),
  );
} finally {
  await browser.close();
}
