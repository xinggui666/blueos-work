#!/usr/bin/env node
/**
 * 网页端 RPK 构建与组件放置端到端（阶段 4）。需要空库 + 运行中的服务 + 官方工具链：
 *   DATABASE_URL=（与服务同一个库） BLUEOS_TOOLKIT_DIR=/opt/blueos-toolkit [BLUEOS_RPK_SIGN_DIR=...] \
 *   E2E_BASE=http://localhost:8099 node scripts/e2e/web-build.mjs
 * 覆盖：连续加 4 个组件不重叠 → 交付面板「构建 RPK」→ 预扣 → Worker 编译成功 → 页面显示成功和 SHA-256
 * → 日志与产物检查 → 浏览器下载的 RPK 和服务器记录的哈希一致。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE || "http://localhost:8080").replace(/\/+$/, "");
const H = { "content-type": "application/json", origin: BASE };
const tag = Date.now().toString(36);
const password = "E2e-Passw0rd!";
let ok = 0;
const step = async (name, fn) => {
  await fn();
  ok++;
  console.log(`✔ ${name}`);
};
async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: H, body: JSON.stringify({ email, password }) });
  await res.text();
  return res.headers.get("set-auth-token");
}
async function call(token, action, payload = {}) {
  const res = await fetch(`${BASE}/api/v1/platform`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}` }, body: JSON.stringify({ action, payload, client: "web" }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const adminEmail = `admin-${tag}@webbuild.local`;
await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: H, body: JSON.stringify({ email: adminEmail, password, name: "admin" }) }).then((r) => r.text());
const admin = await signIn(adminEmail);
await call(admin, "me"); // 空库：第一个调用接口的账号成为超级管理员
assert.equal((await call(admin, "adminSetConfig", { key: "build_enabled", value: true })).status, 200);

const worker = spawn(process.execPath, ["worker/build-worker.mjs"], { env: { ...process.env, WORKER_ID: `web-${tag}` }, stdio: ["ignore", "ignore", "inherit"] });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const side = () => page.locator("aside").last();
const email = `user-${tag}@webbuild.local`;

try {
  let projectId = "";
  await step("注册、新建工程，连续加 4 个组件", async () => {
    await page.goto(`${BASE}/login`);
    await page.getByRole("button", { name: "注册" }).click();
    await page.getByLabel("名字").fill("e2e");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "创建账号" }).click();
    await page.waitForURL(`${BASE}/`, { timeout: 20_000 });
    await page.getByRole("button", { name: "新建" }).click();
    await page.getByLabel("工程名").fill("构建测试");
    await page.getByRole("button", { name: "创建并编辑" }).click();
    await page.waitForURL(/\/edit\//, { timeout: 20_000 });
    projectId = page.url().split("/edit/")[1];
    const palette = page.locator("aside").first();
    for (const name of [/^按钮/, /^按钮/, /^文本/, /^文本/]) await palette.getByRole("button", { name }).click();
  });

  const user = await signIn(email);
  const userId = (await call(user, "me")).json.userId;
  assert.equal((await call(admin, "adminGrantQuota", { userId, kind: "build", delta: 1 })).status, 200);

  await step("交付面板点「构建 RPK」：先保存再预扣 1 分", async () => {
    await side().getByRole("button", { name: "交付", exact: true }).click();
    // 等 Worker 心跳上线（直接看 build_workers 表）。
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    for (let i = 0; i < 60; i++) {
      const r = await db.query("select 1 from build_workers where id = $1 and seen_at > now() - interval '60 seconds'", [`web-${tag}`]);
      if (r.rowCount) break;
      await new Promise((d) => setTimeout(d, 1000));
    }
    await db.end();
    await side().getByRole("button", { name: "构建 RPK" }).click();
    await side().getByTestId("build-note").waitFor({ timeout: 30_000 });
    const note = await side().getByTestId("build-note").innerText();
    assert.match(note, /预扣 1 个打包积分/, note);
  });

  await step("新加的组件找空位：前两个和任何组件都不重叠；画面放满后也不会叠在同一点", async () => {
    const r = await call(user, "getProjectDoc", { projectId });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const doc = r.json.doc ?? r.json;
    const rects = doc.pages[0].components.map((c) => c.layout);
    const added = rects.slice(-4);
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const a of added.slice(0, 2))
      for (const b of rects) if (a !== b) assert.equal(hit(a, b), false, `${JSON.stringify(a)} 和 ${JSON.stringify(b)} 重叠`);
    const spots = new Set(rects.map((c) => `${c.x},${c.y}`));
    assert.equal(spots.size, rects.length, JSON.stringify(rects));
  });

  let sha = "";
  await step("Worker 编译成功：页面显示成功、SHA-256，积分确认扣除", async () => {
    const row = side().getByTestId("build-row").first();
    await row.getByText("成功", { exact: true }).waitFor({ timeout: 240_000 });
    sha = (await row.innerText()).match(/SHA-256 ([0-9a-f]{64})/)?.[1] ?? "";
    assert.ok(sha, await row.innerText());
    await row.getByText("已扣 1 分").waitFor();
    assert.deepEqual((await call(user, "me")).json.quota.build, { balance: 0, reserved: 0 });
  });

  await step("日志与产物检查可以展开", async () => {
    const row = side().getByTestId("build-row").first();
    await row.getByRole("button", { name: "日志与检查" }).click();
    await row.locator("li").filter({ hasText: /^✔ 签名证书 META-INF\/CERT/ }).waitFor();
    await row.locator("li").filter({ hasText: /^✔ 页面已编译进包/ }).waitFor();
  });

  await step("浏览器下载的 RPK 和记录的 SHA-256 一致", async () => {
    const row = side().getByTestId("build-row").first();
    const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: "下载 RPK" }).click()]);
    assert.match(download.suggestedFilename(), /\.rpk$/);
    const file = await download.path();
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), sha);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${ok} 通过（${BASE}）`);
} catch (error) {
  await page.screenshot({ path: "/tmp/web-build-fail.png", fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  worker.kill("SIGTERM");
}
