#!/usr/bin/env node
/** Diagnostic reproduction, NOT an APK acceptance test or a claim about historical ANR cause. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { APP_URL, installMockNative } from "./android-mock.mjs";
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await installMockNative(context, {
    apiBase: process.env.API_BASE || "http://localhost:4019",
    versionCode: 10,
    versionName: "1.0.0",
  });
  let blocked = 0;
  await context.route("**/www/assets/app-*.js", async (route) => {
    blocked++;
    await route.fulfill({
      status: 404,
      contentType: "text/javascript",
      body: "/* declared missing-chunk fixture */",
    });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(APP_URL);
  await page.waitForTimeout(1000);
  assert.ok(blocked > 0);
  assert.equal((await page.locator("#root").innerText()).trim(), "");
  assert.ok(errors.some((e) => /dynamically imported module|module script/i.test(e)));
  console.log(
    "REPRODUCED: missing dynamic app chunk leaves current bundled client's root empty with unhandled import rejection",
  );
  console.log(
    "Client startup resilience defect confirmed in Chromium+mock bridge; NOT proof of the earlier final APK/emulator ANR root cause; no device run performed",
  );
} finally {
  await browser.close();
}
