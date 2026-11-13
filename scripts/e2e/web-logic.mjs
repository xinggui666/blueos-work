#!/usr/bin/env node
/**
 * 网页工坊逻辑编辑端到端（阶段 3）：
 * 注册 → 新建工程 → 加按钮和文本 → 新建变量 → 按钮点击 count = count + 1 → 文本绑定表达式、时间绑定
 * → 预览点击、调试器看到事件记录和变量值 → 时间快进 → 云端协议文档校验通过 → 撤销/重做逻辑修改。
 *   E2E_BASE=http://localhost:8099 node scripts/e2e/web-logic.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE || "http://localhost:8080").replace(/\/+$/, "");
const email = `logic-${Date.now().toString(36)}@smoke.local`;
const password = "E2e-Passw0rd!";
const H = { "content-type": "application/json", origin: BASE };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function api(token, action, payload = {}) {
  const res = await fetch(`${BASE}/api/v1/platform`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}` }, body: JSON.stringify({ action, payload, client: "android" }) });
  return { status: res.status, json: await res.json() };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let ok = 0;
const step = async (name, fn) => {
  await fn();
  ok++;
  console.log(`✔ ${name}`);
};
const side = () => page.locator("aside").last();
const stage = () => page.locator("div.touch-none").first();
async function setY(y) {
  const field = side().getByLabel("Y", { exact: true });
  await field.fill(String(y));
  await field.blur();
}

try {
  await step("注册并新建工程", async () => {
    await page.goto(`${BASE}/login`);
    await page.getByRole("button", { name: "注册" }).click();
    await page.getByLabel("名字").fill("e2e");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "创建账号" }).click();
    await page.waitForURL(`${BASE}/`, { timeout: 20_000 });
    await page.getByRole("button", { name: "新建" }).click();
    await page.getByLabel("工程名").fill("逻辑测试");
    await page.getByRole("button", { name: "创建并编辑" }).click();
    await page.waitForURL(/\/edit\//, { timeout: 20_000 });
  });
  const projectId = page.url().split("/edit/")[1];

  await step("加按钮，属性面板里给点击加「修改变量」", async () => {
    // 先建变量（逻辑 → 变量）。
    await side().getByRole("button", { name: "逻辑", exact: true }).click();
    await side().getByRole("button", { name: "变量", exact: true }).click();
    await side().getByRole("button", { name: "变量" }).last().click();
    await side().getByText("count").first().waitFor();
    // 加按钮（会自动选中）。
    await page.locator("aside").first().getByRole("button", { name: /^按钮/ }).click();
    await side().getByRole("button", { name: "属性", exact: true }).click();
    await setY(320);
    await side().getByLabel("点击时执行").selectOption("setVar");
    await side().getByRole("button", { name: "添加", exact: true }).click();
    const value = side().getByLabel("新值");
    await value.fill("count + 1");
    await value.blur();
    await side().getByText("结果类型 int").waitFor();
  });

  await step("加文本，高级模式绑定表达式；另一个文本绑定时间", async () => {
    await page.getByRole("button", { name: "简易" }).click(); // 切到高级
    await page.locator("aside").first().getByRole("button", { name: /^文本/ }).click();
    await setY(80);
    await side().getByRole("button", { name: "+ 表达式" }).click();
    const expr = side().getByLabel("表达式").last();
    await expr.fill('"次数 " + str(count)');
    await expr.blur();
    await side().getByText("结果类型 string").waitFor();
    await page.locator("aside").first().getByRole("button", { name: /^文本/ }).click();
    await setY(180);
    await side().getByRole("button", { name: "+ 绑定时间" }).click();
    await side().getByText(/现在显示：\d\d:\d\d/).waitFor();
  });

  await step("检查页没有错误", async () => {
    await side().getByRole("button", { name: "逻辑", exact: true }).click();
    await side().getByRole("button", { name: /^检查/ }).click();
    await side().getByText("没有错误。").waitFor();
  });

  await step("预览：点按钮两次，文本显示「次数 2」，调试器有事件记录和变量值", async () => {
    await page.getByRole("button", { name: "预览" }).click();
    await stage().getByText("次数 0").waitFor();
    await stage().getByText("开始").click();
    await sleep(400);
    await stage().getByText("开始").click();
    await stage().getByText("次数 2").waitFor();
    await side().getByText(/触发$/).first().waitFor();
    await side().getByText(/count = 2/).first().waitFor();
    await side().getByRole("button", { name: "变量与计时器" }).click();
    assert.equal(await side().getByLabel("变量 count 当前值").inputValue(), "2");
    await side().getByLabel("变量 count 当前值").fill("7");
    await side().getByLabel("变量 count 当前值").blur();
    await stage().getByText("次数 7").waitFor();
  });

  await step("时间模拟：+1 小时后时间绑定文本变化", async () => {
    const shown = async () => (await stage().innerText()).match(/\d\d:\d\d/)?.[0];
    await side().getByRole("button", { name: "暂停时间" }).click();
    const before = await shown();
    await side().getByRole("button", { name: "+1 小时" }).click();
    const after = await shown();
    assert.ok(before && after && before !== after, `${before} → ${after}`);
    await page.getByRole("button", { name: "编辑" }).click();
  });

  const login = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: H, body: JSON.stringify({ email, password }) });
  const token = login.headers.get("set-auth-token");
  assert.ok(token);

  await step("云端协议文档：变量、点击事件、表达式和时间绑定都在，服务端校验通过", async () => {
    let doc;
    for (let i = 0; i < 30; i++) {
      const r = await api(token, "getProjectDoc", { projectId });
      doc = r.json.doc;
      if (doc && doc.bindings.length >= 2 && doc.events.some((e) => e.actions[0]?.kind === "setVar")) break;
      await sleep(500);
    }
    assert.equal(doc.variables.filter((v) => v.key === "count").length, 1);
    const clicks = doc.events.filter((e) => e.actions[0]?.kind === "setVar");
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0].actions[0].value, "count + 1");
    assert.ok(doc.bindings.some((b) => b.source.kind === "expr" && b.source.expr.includes("str(count)")), JSON.stringify(doc.bindings));
    assert.ok(doc.bindings.some((b) => b.source.kind === "time"), JSON.stringify(doc.bindings));
    const v = await api(token, "validateProject", { doc });
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.equal(v.json.ok, true, JSON.stringify(v.json.issues));
  });

  await step("删除事件后撤销，事件回来；重做又删掉", async () => {
    await side().getByRole("button", { name: "逻辑", exact: true }).click();
    await side().getByRole("button", { name: "事件", exact: true }).click();
    const total = side().getByRole("button", { name: /^全部 \d+$/ });
    const n = Number((await total.innerText()).replace(/\D/g, ""));
    assert.ok(n >= 1);
    await side().getByRole("button", { name: "删除事件" }).last().click();
    await side().getByRole("button", { name: `全部 ${n - 1}` }).waitFor();
    await page.getByRole("button", { name: "撤销" }).click();
    await side().getByRole("button", { name: `全部 ${n}` }).waitFor();
    await page.getByRole("button", { name: "重做" }).click();
    await side().getByRole("button", { name: `全部 ${n - 1}` }).waitFor();
  });

  assert.deepEqual(errors, []);
  console.log(`\n${ok} 通过（${BASE}）`);
} catch (error) {
  console.log(`✖ ${error instanceof Error ? error.message : error}`);
  await page.screenshot({ path: "/tmp/e2e-logic-fail.png", fullPage: true });
  process.exitCode = 1;
} finally {
  await browser.close();
}
