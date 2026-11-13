#!/usr/bin/env node
/** Two independent UIs against one real account/API. Android native bridge is simulated, not an emulator test. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { APP_URL, installMockNative } from "./android-mock.mjs";
const BASE = process.env.E2E_BASE || "http://localhost:3994";
const browser = await chromium.launch();
const phoneContext = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const mock = await installMockNative(phoneContext, { apiBase: BASE });
const phone = await phoneContext.newPage();
const web = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
for (const page of [phone, web]) page.on("pageerror", (e) => errors.push(e.message));
const email = `cross-${Date.now().toString(36)}@smoke.local`, password = "Cross-Passw0rd!";
let ok = 0;
async function step(name, fn) { await fn(); console.log(`✔ ${name}`); ok++; }
async function api(action, payload = {}) {
 const res = await fetch(`${BASE}/api/v1/platform`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${mock.state.token}`, origin: BASE }, body: JSON.stringify({ action, payload, client: "android" }) });
 assert.equal(res.status, 200); return res.json();
}
let id;
try {
 await step("Android 内置 UI 注册并创建工程，云端保存", async () => {
  await phone.goto(APP_URL);
  await phone.getByRole("button", { name: "注册", exact: true }).click();
  await phone.getByLabel("服务器地址").fill(BASE);
  await phone.getByLabel("昵称").fill("跨端用户");
  await phone.getByLabel("邮箱").fill(email); await phone.getByLabel("密码").fill(password);
  await phone.getByRole("button", { name: "注册并登录" }).click();
  await phone.getByRole("button", { name: "新建" }).click();
  await phone.getByLabel("工程名").fill("Android创建的工程");
  await phone.getByRole("button", { name: "创建并编辑" }).click();
  await phone.waitForURL(/#\/edit\//); id = phone.url().split("#/edit/")[1];
  await phone.getByText("已保存到云端").first().waitFor();
  await phone.waitForTimeout(1500);
  const saved = await api("getProjectDoc", { projectId:id });
  assert.equal(saved.doc.project.name, "Android创建的工程");
 });
 await step("独立网页端真实登录，看到 Android 创建的工程", async () => {
  await web.goto(`${BASE}/login`); await web.getByRole("button", { name: "登录", exact: true }).click();
  await web.getByLabel("邮箱").fill(email); await web.getByLabel("密码").fill(password);
  await web.getByRole("button", { name: "进入工坊" }).click();
  await web.waitForURL(`${BASE}/`); await web.getByText("Android创建的工程").first().waitFor();
 });
 await step("网页端编辑组件 → Android 重新同步后画布出现同一文本", async () => {
  await web.getByText("Android创建的工程").first().click();
  await web.waitForURL(/\/edit\//);
  await web.locator("aside").first().getByRole("button", { name: /^文本/ }).click();
  const side = web.locator("aside").last();
  await side.getByRole("button", { name: "属性", exact: true }).click();
  const labels = await side.locator("label").allTextContents();
  const input = side.getByLabel("内容", { exact: true });
  assert.equal(await input.count(), 1, labels.join(";"));
  await input.fill("网页写入跨端文本"); await input.blur();
  for (let i=0;i<40;i++) {
   const p = await api("getProjectDoc", { projectId:id });
   if (JSON.stringify(p.doc).includes("网页写入跨端文本")) break;
   await new Promise(r=>setTimeout(r,300));
  }
  await phone.reload(); await phone.getByText("网页写入跨端文本", { exact: true }).first().waitFor({timeout:20000});
 });
 await step("Android 修改同一组件 → 网页重新同步后读到同一内容", async () => {
  await phone.getByText("网页写入跨端文本", { exact: true }).first().click();
  await phone.getByRole("button", { name: "属性", exact: true }).last().click();
  const input = phone.getByTestId("mobile-sheet").getByLabel("内容", { exact: true });
  await input.fill("Android写回跨端文本"); await input.blur();
  for (let i=0;i<40;i++) {
   const p = await api("getProjectDoc", { projectId:id });
   if (JSON.stringify(p.doc).includes("Android写回跨端文本")) break;
   await new Promise(r=>setTimeout(r,300));
  }
  await web.reload(); await web.getByText("Android写回跨端文本", { exact: true }).first().waitFor({timeout:20000});
 });
 assert.deepEqual(errors, []); console.log(`\n${ok} 通过（独立网页 UI ↔ Android 内置 UI，原生桥替身，真实 API）`);
} catch(error) {
 console.error(error); await phone.screenshot({path:"/tmp/cross-phone-fail.png"}); await web.screenshot({path:"/tmp/cross-web-fail.png"}); process.exitCode=1;
} finally { await browser.close(); }
