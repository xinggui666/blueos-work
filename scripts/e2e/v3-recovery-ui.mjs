#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://localhost:4019";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname))
  throw Error("disposable localhost server required");
const browser = await chromium.launch(),
  context = await browser.newContext(),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let pass = 0;
async function step(name, fn) {
  await fn();
  pass++;
  console.log("PASS", name);
}
async function drafts() {
  return page.evaluate(async () => {
    const { useStudio } = await import("/src/lib/blueos/store.ts");
    return useStudio.getState().projects.map((p) => ({ id: p.id, name: p.name }));
  });
}
async function clickWith(decisions) {
  let i = 0;
  const handler = async (d) => {
    if (decisions[i++]) await d.accept();
    else await d.dismiss();
  };
  page.on("dialog", handler);
  try {
    await page.getByRole("button", { name: "恢复旧版草稿", exact: true }).click();
    return i;
  } finally {
    page.off("dialog", handler);
  }
}
try {
  const email = `recovery-${Date.now().toString(36)}@tests.invalid`;
  const r = await context.request.post(BASE + "/api/auth/sign-up/email", {
    headers: { origin: BASE },
    data: { email, password: "V3-Recovery-UI-Fixture!", name: "Recovery fixture" },
  });
  assert.equal(r.status(), 200);
  await page.goto(BASE);
  await page.getByRole("button", { name: "新建", exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  const original = await page.evaluate(async () => {
    const { makeFromTemplate } = await import("/src/lib/blueos/model.ts");
    const p = makeFromTemplate("blank", {
      name: "Unowned personal draft",
      appName: "Draft",
      packageName: "com.example.recovery",
      device: "watch-round",
    });
    const raw = JSON.stringify({ state: { projects: [p] }, version: 0 });
    localStorage.setItem("blueos-studio-v1", raw);
    return { raw, id: p.id };
  });
  await step("old unowned raw cache is never automatically adopted on reload", async () => {
    await page.reload();
    await page.getByRole("button", { name: "恢复旧版草稿" }).waitFor();
    await page.waitForLoadState("networkidle");
    assert.deepEqual(await drafts(), []);
  });
  await step(
    "first ownership confirmation cancellation changes no project or source bytes",
    async () => {
      assert.equal(await clickWith([false]), 1);
      assert.deepEqual(await drafts(), []);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("blueos-studio-v1")),
        original.raw,
      );
    },
  );
  await step(
    "second server/account upload confirmation cancellation still changes nothing",
    async () => {
      assert.equal(await clickWith([true, false]), 2);
      assert.deepEqual(await drafts(), []);
    },
  );
  await step(
    "two explicit confirmations recover a new copy and actual cloud upload without deleting old data",
    async () => {
      assert.equal(await clickWith([true, true]), 2);
      const list = await drafts();
      assert.equal(list.length, 1);
      assert.notEqual(list[0].id, original.id);
      assert.match(list[0].name, /旧草稿恢复/);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("blueos-studio-v1")),
        original.raw,
      );
      await page.waitForFunction(async () => {
        const r = await fetch("/api/v1/platform", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "listProjects", payload: {}, client: "web" }),
        });
        return r.ok && (await r.json()).some((p) => p.name.includes("旧草稿恢复"));
      });
    },
  );
  await step("owner-tagged legacy account data is neither previewed nor imported", async () => {
    await page.evaluate(() => {
      localStorage.setItem("bw-owner", "different-owner");
      localStorage.setItem(
        "blueos-studio-v1",
        JSON.stringify({ state: { projects: [{ name: "DO-NOT-EXPOSE-OTHER-OWNER" }] } }),
      );
    });
    assert.equal(await clickWith([]), 0);
    await page.getByRole("status").getByText(/归属/).waitFor();
    assert.equal(await page.getByText("DO-NOT-EXPOSE-OTHER-OWNER", { exact: true }).count(), 0);
    assert.equal((await drafts()).length, 1);
  });
  await step("corrupt JSON is preserved and cannot partially import", async () => {
    await page.evaluate(() => {
      localStorage.removeItem("bw-owner");
      localStorage.setItem("blueos-studio-v1", "{broken");
    });
    assert.equal(await clickWith([true]), 1);
    assert.equal((await drafts()).length, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem("blueos-studio-v1")), "{broken");
  });
  assert.deepEqual(errors, []);
  console.log(`${pass} actual browser recovery UI cases passed; not Android runtime`);
} finally {
  await browser.close();
}
