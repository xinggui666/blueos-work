#!/usr/bin/env node
/**
 * Android 内置界面端到端（第十六章 / 19.4）：在 Chromium 手机视口里加载 APK 里的 assets/www，
 * 原生桥由 android-mock.mjs 模拟，请求发到真实服务器。
 *   npm run build:android-web
 *   API_BASE=http://127.0.0.1:3980 node scripts/e2e/android-web.mjs
 * V3需E2E_ADMIN_EMAIL/PASSWORD指定已由运维CLI初始化的隔离管理员；普通A不提权。E2E_SHOTS=目录 时保存截图。
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { APP_URL, installMockNative } from "./android-mock.mjs";

const BASE = (process.env.API_BASE || "http://127.0.0.1:3980").replace(/\/+$/, "");
const SHOTS = process.env.E2E_SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now().toString(36);
const userA = { email: `and-a-${stamp}@smoke.local`, password: "Andr0id-Passw0rd!", name: "安卓A" };
const userB = { email: `and-b-${stamp}@smoke.local`, password: "Andr0id-Passw0rd!", name: "安卓B" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(token, action, payload = {}) {
  const res = await fetch(`${BASE}/api/v1/platform`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, payload, client: "android" }),
  });
  return { status: res.status, json: await res.json() };
}
async function until(fn, label, tries = 40) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`等待超时：${label}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN",
});
const mock = await installMockNative(context, {
  apiBase: BASE,
  versionCode: 10,
  versionName: "1.0.0",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => void d.accept());
let ok = 0;
const step = async (name, fn) => {
  await fn();
  ok++;
  console.log(`✔ ${name}`);
};
const shot = async (name) => SHOTS && (await page.screenshot({ path: `${SHOTS}/${name}.png` }));
const sheet = () => page.getByTestId("mobile-sheet");
const tab = (name) => page.locator("nav").last().getByRole("link", { name, exact: true });

async function signUp(user) {
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("服务器地址").fill(BASE);
  await page.getByLabel("昵称").fill(user.name);
  await page.getByLabel("邮箱").fill(user.email);
  await page.getByLabel("密码").fill(user.password);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByRole("heading", { name: "编辑免费，打包另计" }).waitFor({ timeout: 20_000 });
}
async function signInUi(user) {
  await page.getByRole("button", { name: "登录", exact: true }).first().click();
  await page.getByLabel("服务器地址").fill(BASE);
  await page.getByLabel("邮箱").fill(user.email);
  await page.getByLabel("密码").fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).last().click();
  await page.getByRole("heading", { name: "编辑免费，打包另计" }).waitFor({ timeout: 20_000 });
}
const cachedProjects = () =>
  page.evaluate(() => {
    const { base, user } = JSON.parse(window.BlueOSNative.session());
    if (!user) return [];
    const key = `bw-workspace-v3:${encodeURIComponent(new URL(base).origin)}:${encodeURIComponent(user.id)}:blueos-studio-v1`;
    return JSON.parse(localStorage.getItem(key) || '{"state":{"projects":[]}}').state.projects;
  });
const tokenA = () => mock.state.token;
let adminToken = "";
let projectId = "";
let nodeCount = 0;

async function cloudDoc(token = tokenA()) {
  const r = await api(token, "getProjectDoc", { projectId });
  return r.status === 200 ? r.json : null;
}
const countNodes = (doc) => doc.pages.reduce((n, p) => n + p.components.length, 0);

try {
  await step("启动：未登录进入登录页；http 以外的地址被拒绝", async () => {
    await page.goto(APP_URL);
    await page.getByText("登录后工程会同步到云端，也能离线编辑。").waitFor();
    await page.getByLabel("服务器地址").fill("ftp://example.com");
    await page.getByLabel("邮箱").fill("x@y.z");
    await page.getByLabel("密码").fill("whatever");
    await page.getByRole("button", { name: "登录", exact: true }).last().click();
    await page.getByRole("alert").getByText(/https/).waitFor();
    await shot("01-login");
  });

  await step("注册登录（原生桥带 Bearer 令牌）→ 工程首页", async () => {
    await signUp(userA);
    assert.ok(tokenA(), "原生侧应保存令牌");
    assert.ok(
      process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD,
      "requires explicitly initialized disposable admin fixture",
    );
    const adminLogin = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({
        email: process.env.E2E_ADMIN_EMAIL,
        password: process.env.E2E_ADMIN_PASSWORD,
      }),
    });
    assert.equal(adminLogin.status, 200);
    adminToken = adminLogin.headers.get("set-auth-token");
    assert.ok(adminToken);
    const me = await api(tokenA(), "me");
    assert.equal(me.status, 200);
    await shot("02-home");
  });

  await step("新建工程 → 编辑器 → 云端保存为协议 v2", async () => {
    await page.getByRole("button", { name: "新建" }).click();
    await page.getByLabel("工程名").fill("安卓端到端");
    await page.getByRole("button", { name: "创建并编辑" }).click();
    await page.waitForURL(/#\/edit\//);
    projectId = page.url().split("#/edit/")[1];
    await page.getByText("已保存到云端").first().waitFor({ timeout: 20_000 });
    const doc = await until(cloudDoc, "云端工程");
    assert.equal(doc.doc.schemaVersion, 2);
    nodeCount = countNodes(doc.doc);
    await shot("03-editor");
  });

  await step("手机画布：组件库加按钮、文本；图层列表看到；云端组件数随之增加", async () => {
    await page.getByRole("button", { name: "组件", exact: true }).click();
    await sheet().getByRole("button", { name: /^按钮/ }).click();
    await page.getByRole("button", { name: "组件", exact: true }).click();
    await sheet().getByRole("button", { name: /^文本/ }).click();
    await page.getByRole("button", { name: "图层", exact: true }).click();
    await sheet().getByText(/按钮/).first().waitFor();
    await shot("04-layers");
    await until(async () => {
      const doc = await cloudDoc();
      return doc && countNodes(doc.doc) === nodeCount + 2;
    }, "云端组件数 +2");
    nodeCount += 2;
  });

  await step("会员组件在无权益时锁定（离线也不能绕过组件授权）", async () => {
    await page.getByRole("button", { name: "组件", exact: true }).click();
    const locked = sheet().getByRole("button", { name: /^数字/ });
    assert.ok(await locked.isDisabled(), "数字组件应锁定");
    await sheet().getByText("需要有效会员").first().waitFor();
    await page
      .getByRole("button", { name: "收起" })
      .click()
      .catch(() => {});
  });

  await step("逻辑：建变量；预览模式运行解释器", async () => {
    await page.getByRole("button", { name: "逻辑", exact: true }).click();
    await sheet().getByRole("button", { name: "变量", exact: true }).click();
    await sheet().getByRole("button", { name: "变量" }).last().click();
    await sheet().getByText("count").first().waitFor();
    await until(async () => {
      const doc = await cloudDoc();
      return doc && doc.doc.variables.some((v) => v.key === "count");
    }, "云端变量 count");
    await page
      .getByRole("button", { name: "收起" })
      .click()
      .catch(() => {});
    await page.getByRole("button", { name: "预览" }).click();
    await page.getByRole("button", { name: "编辑" }).waitFor();
    await shot("05-preview");
    await page.getByRole("button", { name: "编辑" }).click();
  });

  await step("离线编辑：断网后加组件只存本机；联网后自动同步到云端", async () => {
    await mock.setOnline(page, false);
    await page.getByTestId("net-status").getByText(/离线/).waitFor();
    await page.getByRole("button", { name: "组件", exact: true }).click();
    await sheet().getByRole("button", { name: /^矩形/ }).click();
    await sleep(1500);
    assert.equal(countNodes((await cloudDoc()).doc), nodeCount, "离线时云端不应变化");
    const local = (await cachedProjects()).find((p) => p.id === projectId);
    assert.ok(JSON.stringify(local).includes("矩形"), "本机缓存应包含离线新增的组件");
    await shot("06-offline");
    await mock.setOnline(page, true);
    await until(async () => countNodes((await cloudDoc()).doc) === nodeCount + 1, "联网后同步");
    nodeCount += 1;
  });

  await step("离线不能绕过云端构建：断网点构建 RPK 只提示网络不可用", async () => {
    await mock.setOnline(page, false);
    await page.getByRole("button", { name: "交付", exact: true }).click();
    await sheet().getByRole("button", { name: "构建 RPK" }).click();
    await sheet()
      .getByText(/网络不可用/)
      .first()
      .waitFor();
    const builds = await api(tokenA(), "listBuilds", { projectId });
    assert.equal(builds.status, 200);
    assert.ok(Array.isArray(builds.json), JSON.stringify(builds.json));
    assert.equal(builds.json.length, 0, "离线不应产生构建任务");
    await mock.setOnline(page, true);
  });

  await step("冲突：另一设备改了云端，本机离线也改了 → 联网后两份都保留", async () => {
    await page
      .getByRole("button", { name: "收起" })
      .click()
      .catch(() => {});
    await mock.setOnline(page, false);
    const r = await cloudDoc();
    r.doc.project.name = "另一台设备改的";
    const saved = await api(tokenA(), "saveProjectDoc", { doc: r.doc, baseRevision: r.revision });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    await page.getByRole("button", { name: "组件", exact: true }).click();
    await sheet().getByRole("button", { name: /^圆形/ }).click();
    await sleep(800);
    await mock.setOnline(page, true);
    await page.locator("a[href*='#/']").first().waitFor();
    await page.goto(`${APP_URL}#/`);
    await page.getByText("另一台设备改的").first().waitFor({ timeout: 20_000 });
    await page
      .getByText(/本机冲突副本/)
      .first()
      .waitFor({ timeout: 20_000 });
    await until(async () => {
      const list = (await api(tokenA(), "listProjects")).json.map((p) => p.name);
      return list.includes("另一台设备改的") && list.some((n) => n.includes("本机冲突副本"));
    }, "云端两份都在");
    await shot("07-conflict");
  });

  await step(
    "下载 .bproj：没有工程下载积分时被服务器拒绝；补发积分后经系统保存框保存 → 再导入为新工程",
    async () => {
      await page.getByText("另一台设备改的").first().click();
      await page.waitForURL(/#\/edit\//);
      await page.getByRole("button", { name: "交付", exact: true }).click();
      await sheet().getByRole("button", { name: "下载工程包" }).click();
      await sheet()
        .getByText(/工程下载积分不足/)
        .waitFor({ timeout: 20_000 });
      const meId = (await api(tokenA(), "me")).json.userId;
      assert.equal(
        (await api(adminToken, "adminGrantQuota", { userId: meId, kind: "export", delta: 2 }))
          .status,
        200,
      );
      await sheet().getByRole("button", { name: "下载工程包" }).click();
      await sheet()
        .getByText(/工程包已下载/)
        .waitFor({ timeout: 20_000 });
      const file = mock.state.saved.at(-1);
      assert.match(file.fileName, /\.bproj$/);
      assert.equal(file.bytes.subarray(0, 2).toString(), "PK");
      await page.goto(`${APP_URL}#/`);
      await page.getByRole("heading", { name: "编辑免费，打包另计" }).waitFor();
      const before = (await cachedProjects()).length;
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: file.fileName,
          mimeType: "application/octet-stream",
          buffer: file.bytes,
        });
      await page.waitForURL(/#\/edit\//, { timeout: 20_000 });
      const after = (await cachedProjects()).length;
      assert.equal(after, before + 1);
      // 页面只有在 inspectBproj 完整性校验通过并确认导入后，才会增加工程并进入编辑器。
    },
  );

  await step("商城：组件列表来自服务器", async () => {
    await page.goto(`${APP_URL}#/market`);
    await page.getByRole("heading").first().waitFor();
    const market = await api(tokenA(), "market");
    assert.ok(market.json.length > 0);
    await page.getByText(market.json[0].name).first().waitFor();
    await shot("08-market");
  });

  await step("权益：兑换卡密后 RPK 积分增加", async () => {
    const created = await api(adminToken, "adminCreateKeys", {
      type: "quota",
      title: "android-e2e",
      quantity: 1,
      expiresInDays: 7,
      payload: { build: 2 },
    });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const before = (await api(tokenA(), "me")).json;
    await tab("权益").click();
    await page.getByPlaceholder("BH-XXXX-XXXX").fill(created.json.codes[0]);
    await page.getByRole("button", { name: "兑换", exact: true }).click();
    await page.getByText("兑换成功").waitFor();
    const after = (await api(tokenA(), "me")).json;
    assert.equal(
      after.quota.build.balance,
      before.quota.build.balance + 2,
      JSON.stringify(after.quota),
    );
    await shot("09-account");
  });

  await step("任务页可打开", async () => {
    await tab("任务").click();
    await page
      .getByText(/任务|生成/)
      .first()
      .waitFor();
  });

  await step("版本更新：发布 1.1.0 → 出现更新提示；最低版本提高 → 强制更新页", async () => {
    const sha = "a".repeat(64);
    const rel = await api(adminToken, "adminSaveRelease", {
      release: {
        id: "rel_and_e2e",
        channel: "stable",
        versionName: "1.1.0",
        versionCode: 11,
        minVersionCode: 1,
        notes: "安卓端到端发布",
        apkUrl: "https://example.com/blueos-1.1.0.apk",
        sha256: sha,
        active: true,
      },
    });
    assert.equal(rel.status, 200, JSON.stringify(rel.json));
    await page.goto(`${APP_URL}#/settings`);
    await page.reload();
    await page.getByText("有新版本 1.1.0").first().waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "检查更新" }).click();
    await page.getByRole("button", { name: "下载并安装 1.1.0" }).waitFor();
    await shot("10-update");
    const force = await api(adminToken, "adminSaveRelease", {
      release: {
        id: "rel_and_e2e",
        channel: "stable",
        versionName: "1.1.0",
        versionCode: 11,
        minVersionCode: 11,
        notes: "必须更新",
        apkUrl: "https://example.com/blueos-1.1.0.apk",
        sha256: sha,
        active: true,
      },
    });
    assert.equal(force.status, 200);
    await page.reload();
    await page.getByText("需要更新").waitFor({ timeout: 20_000 });
    await shot("11-force-update");
    await page.getByRole("button", { name: "下载并安装 1.1.0" }).click();
    await page.getByText("模拟环境不安装").waitFor();
    await page.getByRole("button", { name: "更新失败或暂时无法安装：返回本机工作空间" }).click();
    await page.getByText("需要更新", { exact: true }).waitFor({ state: "hidden" });
    await api(adminToken, "adminSaveRelease", {
      release: {
        id: "rel_and_e2e",
        channel: "stable",
        versionName: "1.1.0",
        versionCode: 11,
        minVersionCode: 1,
        notes: "",
        apkUrl: "",
        sha256: "",
        active: false,
      },
    });
    await page.reload();
    await page
      .getByRole("heading", { name: "编辑免费，打包另计" })
      .or(page.getByText("设置").first())
      .first()
      .waitFor();
  });

  await step("登录过期：服务端令牌失效 → 回到登录页，本机工程保留，重新登录后还在", async () => {
    const localBefore = (await cachedProjects()).length;
    await fetch(`${BASE}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenA()}`,
        "content-type": "application/json",
        origin: BASE,
      },
      body: "{}",
    });
    await page.goto(`${APP_URL}#/market`);
    await page.reload();
    await page.getByText("登录已过期，请重新登录。本机工程都还在。").waitFor({ timeout: 20_000 });
    await signInUi(userA);
    const localAfter = (await cachedProjects()).length;
    assert.ok(localAfter >= localBefore, `${localBefore} → ${localAfter}`);
  });

  await step("换账号：B 看不到 A 的本机工程；切回 A 工程原样恢复", async () => {
    const namesA = (await cachedProjects()).map((p) => p.name).sort();
    await tab("设置").click();
    await page.getByRole("button", { name: /退出登录/ }).click();
    await page.getByLabel("服务器地址").waitFor();
    await signUp(userB);
    await sleep(1500);
    const namesB = (await cachedProjects()).map((p) => p.name);
    assert.ok(!namesB.includes("另一台设备改的"), namesB.join(","));
    const cloudB = (await api(mock.state.token, "listProjects")).json.map((p) => p.name);
    assert.ok(!cloudB.includes("另一台设备改的"), "A 的工程不应同步进 B 的账号");
    await tab("设置").click();
    await page.getByRole("button", { name: /退出登录/ }).click();
    await signInUi(userA);
    await sleep(1500);
    const back = (await cachedProjects()).map((p) => p.name).sort();
    for (const name of namesA) assert.ok(back.includes(name), `缺少 ${name}`);
  });

  await step("屏幕适配：小屏 360×640、平板 800×1280 首页和编辑器都没有横向溢出", async () => {
    for (const [w, h] of [
      [360, 640],
      [800, 1280],
      [915, 412],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${APP_URL}#/`);
      await page.getByRole("heading", { name: "编辑免费，打包另计" }).waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `首页 ${w}×${h} 横向溢出`,
      );
      await page.goto(`${APP_URL}#/edit/${projectId}`);
      await page.getByRole("button", { name: "预览" }).waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `编辑器 ${w}×${h} 横向溢出`,
      );
      await shot(`12-editor-${w}x${h}`);
    }
  });

  assert.deepEqual(errors, []);
  console.log(`\n${ok} 通过（${BASE}）`);
} catch (error) {
  console.log(`✖ ${error instanceof Error ? error.stack : error}`);
  await page.screenshot({ path: "/tmp/e2e-android-fail.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
