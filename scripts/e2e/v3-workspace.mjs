#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://localhost:4011";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname))
  throw new Error("V3 browser fixtures require a disposable localhost server");
const browser = await chromium.launch();
const context = await browser.newContext();
let page = await context.newPage();
let passed = 0;
const errors = [];
const tag = Date.now().toString(36),
  password = "V3-Workspace-Test-Only!";
page.on("pageerror", (e) => errors.push(e.message));
async function step(name, fn) {
  await fn();
  passed++;
  console.log("PASS", name);
}
async function auth(who, signup = true) {
  const r = await context.request.post(
    BASE + "/api/auth/" + (signup ? "sign-up/email" : "sign-in/email"),
    {
      headers: { origin: BASE },
      data: { email: `v3-${who}-${tag}@tests.invalid`, password, name: who },
    },
  );
  assert.equal(r.status(), 200, await r.text());
  return (await r.json()).user.id;
}
async function api(action, payload = {}) {
  const r = await context.request.post(BASE + "/api/v1/platform", {
    headers: { origin: BASE },
    data: { action, payload, client: "web" },
  });
  return { status: r.status(), body: await r.json() };
}
async function open(expected) {
  await page.goto(BASE);
  await page.waitForFunction(async (expected) => {
    const { useStudio } = await import("/src/lib/blueos/store.ts");
    const m = await import("/src/lib/platform/workspace.ts");
    return useStudio.getState().hydrated && m.workspace()?.userId === expected;
  }, expected);
  await page.getByRole("button", { name: "新建", exact: true }).waitFor();
  // Only cut the network after initial application modules have finished loading.
  await page.waitForLoadState("networkidle");
}
async function projects() {
  return page.evaluate(async () => {
    const { useStudio } = await import("/src/lib/blueos/store.ts");
    return useStudio.getState().projects.map((p) => ({ id: p.id, name: p.name }));
  });
}
async function create(name) {
  return page.evaluate(async (name) => {
    const { useStudio } = await import("/src/lib/blueos/store.ts");
    return useStudio.getState().createProject({
      name,
      appName: name,
      packageName: "com.v3.workspace",
      device: "watch-round",
    });
  }, name);
}
try {
  let A, B, aid;
  await step("A caches an offline draft in real browser store", async () => {
    A = await auth("A");
    await open(A);
    await context.setOffline(true);
    aid = await create("A-offline-private");
    await page.waitForTimeout(1000);
    assert.ok((await projects()).some((p) => p.id === aid));
    assert.ok(
      await page.evaluate(async (id) => {
        const m = await import("/src/lib/platform/workspace.ts");
        const raw = m.scopedStorage(localStorage).getItem("blueos-studio-v1");
        return raw && JSON.parse(raw).state.projects.some((p) => p.id === id);
      }, aid),
      "offline draft must be durably persisted before switching",
    );
  });
  await step(
    "switch shared cookies to B: old A background writes cannot upload into B",
    async () => {
      await context.setOffline(false);
      B = await auth("B");
      await page.waitForTimeout(1300);
      const result = await api("listProjects");
      assert.equal(result.status, 200);
      assert.ok(!result.body.some((p) => p.name === "A-offline-private"));
      const stale = await api("syncProject", { expectedUserId: A, project: {} });
      assert.equal(stale.status, 409);
    },
  );
  await step("B cannot see A cache after reload, including offline edits", async () => {
    await open(B);
    assert.ok(!(await projects()).some((p) => p.name === "A-offline-private"));
    await context.setOffline(true);
    await create("B-offline-private");
    await page.waitForTimeout(850);
  });
  await step("tab close/restart and return to A restores A, never B", async () => {
    await page.close();
    await context.setOffline(false);
    await auth("A", false);
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await open(A);
    const list = await projects();
    assert.ok(list.some((p) => p.name === "A-offline-private"));
    assert.ok(!list.some((p) => p.name === "B-offline-private"));
  });
  await step("offline deletion remains deleted after restart/reconnect", async () => {
    await page.getByText("已保存到云端").first().waitFor();
    await context.setOffline(true);
    await page.evaluate(async (id) => {
      const { useStudio } = await import("/src/lib/blueos/store.ts");
      useStudio.getState().removeProject(id);
    }, aid);
    await page.close();
    await context.setOffline(false);
    page = await context.newPage();
    await open(A);
    await page.getByText("已保存到云端").first().waitFor();
    assert.ok(!(await projects()).some((p) => p.id === aid));
    assert.ok(!(await api("listProjects")).body.some((p) => p.id === aid));
  });
  await step(
    "same userId on distinct server origins uses independent browser storage keys",
    async () => {
      const result = await page.evaluate(async () => {
        const m = await import("/src/lib/platform/workspace.ts");
        const old = m.workspace();
        m.activateWorkspace("https://server-one.invalid", "same-id");
        m.scopedStorage(localStorage).setItem("probe", "origin-one");
        m.activateWorkspace("https://server-two.invalid", "same-id");
        const empty = m.scopedStorage(localStorage).getItem("probe");
        m.scopedStorage(localStorage).setItem("probe", "origin-two");
        m.activateWorkspace("https://server-one.invalid", "same-id");
        const one = m.scopedStorage(localStorage).getItem("probe");
        m.activateWorkspace(old.origin, old.userId);
        return { empty, one };
      });
      assert.deepEqual(result, { empty: null, one: "origin-one" });
      await page.reload();
    },
  );
  await step("both billable browser delivery gates reject conflict receipt", async () => {
    const result = await page.evaluate(async () => {
      const { prepareDelivery } = await import("/src/lib/platform/delivery.ts");
      const calls = [];
      let rejected = false;
      try {
        const fixed = await prepareDelivery({}, async (action) => {
          calls.push(action);
          return { ok: false, conflict: true };
        });
        calls.push("requestBuild:" + fixed.expectedRevision);
      } catch {
        rejected = true;
      }
      return { calls, rejected };
    });
    assert.deepEqual(result, { calls: ["syncProject"], rejected: true });
  });
  assert.deepEqual(errors, []);
  console.log(
    `${passed} browser integration cases passed; real browser/store/API, no Android runtime claim`,
  );
} catch (e) {
  console.error(e);
  console.error(
    await page
      .evaluate(async () => {
        const m = await import("/src/lib/platform/workspace.ts");
        return {
          scope: m.workspace(),
          cache: Object.keys(localStorage)
            .filter((k) => k.startsWith("bw-workspace-v3:"))
            .map((key) => ({ key, bytes: localStorage.getItem(key)?.length })),
        };
      })
      .catch(() => ({})),
  );
  await page.screenshot({ path: "/tmp/blueos-v3-workspace-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
