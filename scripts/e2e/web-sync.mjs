#!/usr/bin/env node
/**
 * 网页端到端：注册 → 新建工程 → 云端保存为协议 v2 → 另一设备改动后本机离线修改 → 重新打开时保留双方版本。
 *   E2E_BASE=http://127.0.0.1:8099 node scripts/e2e/web-sync.mjs
 * 需要：npx playwright install chromium；服务端为空库或允许注册。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8080").replace(/\/+$/, "");
const email = `e2e-${Date.now().toString(36)}@smoke.local`;
const password = "E2e-Passw0rd!";
const H = { "content-type": "application/json", origin: BASE };

async function api(token, action, payload = {}) {
  const res = await fetch(`${BASE}/api/v1/platform`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}` }, body: JSON.stringify({ action, payload, client: "android" }) });
  return { status: res.status, json: await res.json() };
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let ok = 0;
const step = async (name, fn) => {
  await fn();
  ok++;
  console.log(`✔ ${name}`);
};

try {
  await step("注册并进入工坊", async () => {
    await page.goto(`${BASE}/login`);
    await page.getByRole("button", { name: "注册" }).click();
    await page.getByLabel("名字").fill("e2e");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "创建账号" }).click();
    await page.waitForURL(`${BASE}/`, { timeout: 20_000 });
  });

  let projectId = "";
  await step("新建工程并保存到云端（协议 v2，修订 1）", async () => {
    await page.getByRole("button", { name: "新建" }).click();
    await page.getByLabel("工程名").fill("端到端");
    await page.getByRole("button", { name: "创建并编辑" }).click();
    await page.waitForURL(/\/edit\//, { timeout: 20_000 });
    projectId = page.url().split("/edit/")[1];
    await page.getByText("已保存到云端").first().waitFor({ timeout: 20_000 });
  });

  const login = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: H, body: JSON.stringify({ email, password }) });
  const token = login.headers.get("set-auth-token");
  assert.ok(token);

  await step("服务端拿到协议文档", async () => {
    let r = await api(token, "getProjectDoc", { projectId });
    for (let i = 0; i < 20 && r.status === 404; i++) {
      await new Promise((done) => setTimeout(done, 500));
      r = await api(token, "getProjectDoc", { projectId });
    }
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.doc.schemaVersion, 2);
    assert.ok(r.json.revision >= 1);
  });

  await step("另一设备改名；本机离线也改了 → 重新打开后两份都在", async () => {
    const r = await api(token, "getProjectDoc", { projectId });
    const doc = r.json.doc;
    doc.project.name = "另一台设备改的";
    const s = await api(token, "saveProjectDoc", { doc, baseRevision: r.json.revision });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    await page.goto(`${BASE}/`);
    await page.evaluate((id) => {
      const raw = JSON.parse(localStorage.getItem("blueos-studio-v1"));
      const p = raw.state.projects.find((x) => x.id === id);
      p.name = "本机离线改的";
      p.updatedAt = Date.now();
      localStorage.setItem("blueos-studio-v1", JSON.stringify(raw));
    }, projectId);
    await page.reload();
    await page.getByText("另一台设备改的").first().waitFor({ timeout: 20_000 });
    await page.getByText("本机离线改的（本机冲突副本）").first().waitFor({ timeout: 20_000 });
    const list = await api(token, "listProjects");
    const names = list.json.map((p) => p.name);
    await new Promise((r) => setTimeout(r, 2000));
    const after = (await api(token, "listProjects")).json.map((p) => p.name);
    assert.ok(after.includes("另一台设备改的"), names.join(","));
    assert.ok(after.includes("本机离线改的（本机冲突副本）"), after.join(","));
  });

  assert.deepEqual(errors, []);
  console.log(`\n${ok} 通过（${BASE}）`);
} catch (error) {
  console.log(`✖ ${error instanceof Error ? error.message : error}`);
  await page.screenshot({ path: "/tmp/e2e-fail.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
