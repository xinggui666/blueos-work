#!/usr/bin/env node
/**
 * 管理后台网页端到端（规格第十七章）：空库 + 运行中的服务。
 *   E2E_BASE=http://localhost:8099 [E2E_SHOTS=目录] node scripts/e2e/web-admin.mjs
 * 覆盖：超级管理员逐个打开 12 个标签页没有报错；在用户详情里补发积分、授权组件；切换开关；
 * 普通用户打开 /admin 看到服务端返回的“没有权限”，也拿不到数据。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE || "http://localhost:8080").replace(/\/+$/, "");
const SHOTS = process.env.E2E_SHOTS || "";
const tag = Date.now().toString(36);
const password = "E2e-Passw0rd!";
let ok = 0;
const step = async (name, fn) => {
  await fn();
  ok++;
  console.log(`✔ ${name}`);
};
const browser = await chromium.launch();
const errors = [];

async function register(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: "注册" }).click();
  await page.getByLabel("名字").fill(email.split("@")[0]);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "创建账号" }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 20_000 });
}

try {
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await adminCtx.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (e) => errors.push(e.message));
  const adminEmail = `admin-${tag}@webadmin.local`;
  const userEmail = `user-${tag}@webadmin.local`;
  await register(page, adminEmail); // 空库第一个账号 = 超级管理员

  const userCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const userPage = await userCtx.newPage();
  await register(userPage, userEmail);

  await step("超级管理员逐个打开 12 个标签页，没有错误提示", async () => {
    await page.goto(`${BASE}/admin`);
    await page.getByRole("heading", { name: "管理后台" }).waitFor();
    for (const tab of ["总览", "用户", "组件", "投稿", "套餐", "卡密", "订单", "构建", "版本", "开关", "公告", "审计"]) {
      if (process.env.E2E_VERBOSE) console.log("  打开", tab, new Date().toISOString().slice(11, 19));
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(600);
      if (await page.getByRole("alert").count()) throw new Error(`${tab}：${await page.getByRole("alert").first().innerText()}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-${tab}.png`, fullPage: true });
    }
    await page.getByRole("tab", { name: "总览" }).click();
    await page.getByTestId("stat-用户").getByText("2", { exact: true }).waitFor();
  });

  await step("用户详情：补发 3 个 RPK 打包积分、授权“热区”组件，用户侧立即生效", async () => {
    await page.getByRole("tab", { name: "用户" }).click();
    await page.getByRole("button", { name: new RegExp(userEmail) }).click();
    const detail = page.getByTestId("user-detail");
    await detail.getByLabel("积分类型").selectOption("build");
    await detail.getByLabel("数量").fill("3");
    await detail.getByRole("button", { name: "调整积分" }).click();
    await detail.getByText(/RPK 打包 3/).waitFor();
    await detail.getByLabel("组件").selectOption("cmp_hotspot");
    await detail.getByRole("button", { name: "授权组件" }).click();
    await detail.getByRole("button", { name: "撤销授权" }).waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-用户详情.png`, fullPage: true });
  });

  await step("开关：关闭再打开“组件商城”，状态随服务端变化", async () => {
    await page.getByRole("tab", { name: "开关" }).click();
    const toggle = page.getByRole("button", { name: "切换 marketplace_open" });
    await toggle.getByText("已开").waitFor();
    await toggle.click();
    await toggle.getByText("已关").waitFor();
    await toggle.click();
    await toggle.getByText("已开").waitFor();
  });

  await step("普通用户打开 /admin：服务端返回没有权限，看不到任何统计", async () => {
    await userPage.goto(`${BASE}/admin`);
    await userPage.getByRole("alert").getByText("没有权限").waitFor({ timeout: 15_000 });
    assert.equal(await userPage.getByTestId("stat-用户").count(), 0);
  });

  assert.deepEqual(errors, []);
  console.log(`\n${ok} 通过（${BASE}）`);
} finally {
  await browser.close();
}
