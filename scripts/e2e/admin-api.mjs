#!/usr/bin/env node
/**
 * 管理后台接口端到端（规格第十七章）。需要空库 + 运行中的服务；构建部分还需要官方工具链：
 *   DATABASE_URL=（同一个库） BLUEOS_TOOLKIT_DIR=/opt/blueos-toolkit API_BASE=http://localhost:8099 node scripts/e2e/admin-api.mjs
 * 没有 BLUEOS_TOOLKIT_DIR 时跳过构建重试部分（会打印“跳过”，不算通过）。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { counterDoc } from "../../src/lib/protocol/fixtures.ts";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/+$/, "");
const H = { "content-type": "application/json", origin: process.env.API_ORIGIN || BASE };
const tag = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let skipped = 0;
const step = async (name, fn) => {
  await fn();
  ok++;
  console.log(`✔ ${name}`);
};
async function signUp(email) {
  await (await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "Admin-Passw0rd!", name: email.split("@")[0] }) })).text();
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "Admin-Passw0rd!" }) });
  await res.text();
  return res.headers.get("set-auth-token");
}
async function call(token, action, payload = {}) {
  const res = await fetch(`${BASE}/api/v1/platform`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}` }, body: JSON.stringify({ action, payload, client: "web" }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const okCall = async (token, action, payload) => {
  const r = await call(token, action, payload);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`);
  return r.json;
};

const admin = await signUp(`admin-${tag}@admin.local`);
await call(admin, "me"); // 空库：第一个调用接口的账号成为超级管理员
const user = await signUp(`user-${tag}@admin.local`);
const userId = (await okCall(user, "me")).userId;
const reviewer = await signUp(`rev-${tag}@admin.local`);
const reviewerId = (await okCall(reviewer, "me")).userId;
await okCall(admin, "adminSetRole", { userId: reviewerId, role: "reviewer", grant: true });

const ADMIN_ACTIONS = [
  "adminOverview",
  "adminUsers",
  "adminUser",
  "adminUserProject",
  "adminSetStatus",
  "adminGrantQuota",
  "adminComponents",
  "adminComponent",
  "adminSaveComponent",
  "adminAddComponentVersion",
  "adminUploadAsset",
  "adminPlans",
  "adminSavePlan",
  "adminCreateKeys",
  "adminKeyBatches",
  "adminKeys",
  "adminExportKeys",
  "adminKeyActivations",
  "adminOrders",
  "adminOrder",
  "adminConfirmOrder",
  "adminBuilds",
  "adminBuild",
  "adminRetryBuild",
  "adminCancelBuild",
  "adminDownloadBuild",
  "adminReleases",
  "adminSaveRelease",
  "adminConfig",
  "adminSetConfig",
  "adminAudit",
];

try {
  await step(`普通用户调用 ${ADMIN_ACTIONS.length} 个后台接口全部 403`, async () => {
    for (const action of ADMIN_ACTIONS) {
      const r = await call(user, action, { userId, id: "x", batchId: "x" });
      assert.equal(r.status, 403, `${action} → ${r.status} ${JSON.stringify(r.json)}`);
    }
  });

  await step("审核员只能审投稿，不能看构建、改开关、发积分", async () => {
    assert.equal((await call(reviewer, "adminSubmissions")).status, 200);
    for (const action of ["adminBuilds", "adminSetConfig", "adminGrantQuota", "adminUsers", "adminCreateKeys"]) assert.equal((await call(reviewer, action, { userId, key: "build_enabled", value: true })).status, 403, action);
  });

  const doc = counterDoc();
  doc.project.id = `ad${tag}`.replace(/[^a-z0-9]/g, "");
  await okCall(user, "saveProjectDoc", { doc, baseRevision: 0 });

  await step("总览：用户、活跃、工程、构建成功率、存储等统计", async () => {
    const o = await okCall(admin, "adminOverview");
    assert.ok(o.users >= 3 && o.projects >= 1 && o.activeUsers7d >= 1, JSON.stringify(o));
    for (const k of ["spent30d", "orders", "builds", "failureReasons", "storage"]) assert.ok(k in o, k);
    assert.ok(o.storage.projectsBytes > 0 && o.storage.databaseBytes > 0);
  });

  await step("用户详情：工程列表、积分、设备；只读查看工程会写审计", async () => {
    const d = await okCall(admin, "adminUser", { userId });
    assert.equal(d.email, `user-${tag}@admin.local`);
    assert.equal(d.projectList[0].id, doc.project.id);
    const view = await okCall(admin, "adminUserProject", { userId, projectId: doc.project.id });
    assert.equal(view.doc.project.id, doc.project.id);
    const logs = await okCall(admin, "adminAudit");
    assert.ok(logs.some((l) => l.action === "project.view" && l.target === doc.project.id));
  });

  await step("组件：编辑说明和 SDK、依赖校验、发布新版本、上传资源（只收真图片）", async () => {
    await okCall(admin, "adminSaveComponent", { id: "cmp_time", description: "显示当前时间", sdkMin: "1.0", dependencies: ["text"] });
    assert.equal((await call(admin, "adminSaveComponent", { id: "cmp_time", dependencies: ["no-such"] })).status, 400);
    assert.equal((await call(admin, "adminSaveComponent", { id: "cmp_time", dependencies: ["time"] })).status, 400);
    assert.equal((await call(admin, "adminAddComponentVersion", { id: "cmp_time", version: "0.0.1" })).status, 400);
    const before = await okCall(admin, "adminComponent", { id: "cmp_time" });
    const [a, b, c] = before.latestVersion.split(".").map(Number);
    await okCall(admin, "adminAddComponentVersion", { id: "cmp_time", version: `${a}.${b}.${c + 1}`, changelog: "e2e" });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const up = await okCall(admin, "adminUploadAsset", { id: "cmp_time", name: "icon.png", dataBase64: png });
    assert.equal(up.mime, "image/png");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    assert.equal((await call(admin, "adminUploadAsset", { id: "cmp_time", name: "x.png", dataBase64: svg })).status, 400);
    assert.equal((await call(admin, "adminUploadAsset", { id: "cmp_time", name: "big.png", dataBase64: Buffer.alloc(300_000, 1).toString("base64") })).status, 413);
    const after = await okCall(admin, "adminComponent", { id: "cmp_time" });
    assert.equal(after.latestVersion, `${a}.${b}.${c + 1}`);
    assert.equal(after.description, "显示当前时间");
    assert.deepEqual(after.dependencies, ["text"]);
    assert.equal(after.assets.length, 1);
    const asset = await okCall(admin, "adminAsset", { assetId: up.id });
    assert.equal(asset.dataBase64, png);
  });

  await step("套餐组件权限：只含“交互”分类的会员用不了“数据”类会员组件", async () => {
    await okCall(admin, "adminSavePlan", { plan: { id: "plan_ix", slug: "ix", name: "交互会员", priceCents: 100, durationDays: 30, generation: 0, build: 0, export: 0, concurrency: 1, categories: "交互", active: true } });
    await okCall(admin, "adminGrantMembership", { userId, planId: "plan_ix" });
    const me = await okCall(user, "me");
    assert.ok(me.membership);
    assert.match(me.palette.time, /不在当前套餐/);
  });

  let code = "";
  let batchId = "";
  await step("卡密：生成、批次统计、导出安全清单（无明文）、兑换记录、关闭兑换", async () => {
    const created = await okCall(admin, "adminCreateKeys", { type: "quota", title: "e2e", quantity: 3, expiresInDays: 7, payload: { build: 2 } });
    code = created.codes[0];
    batchId = created.batchId;
    await okCall(user, "redeem", { code });
    await call(user, "redeem", { code: "BH-AAAA-BBBB" });
    const batches = await okCall(admin, "adminKeyBatches");
    const b = batches.find((x) => x.id === batchId);
    assert.equal(b.used, 1);
    assert.equal(b.unused, 2);
    const exp = await okCall(admin, "adminExportKeys", { batchId });
    assert.equal(exp.rows, 3);
    for (const c of created.codes) assert.ok(!exp.csv.includes(c), "清单里出现了明文卡密");
    const acts = await okCall(admin, "adminKeyActivations");
    assert.ok(acts.some((a) => a.result === "ok" && a.email === `user-${tag}@admin.local`));
    assert.ok(acts.some((a) => a.result === "not_found"));
    const used = await okCall(admin, "adminKeys", { batchId, status: "used" });
    assert.equal(used.length, 1);
    assert.equal(used[0].usedBy, `user-${tag}@admin.local`);
    await okCall(admin, "adminSetConfig", { key: "keys_open", value: false });
    assert.equal((await call(user, "redeem", { code: created.codes[1] })).status, 403);
    await okCall(admin, "adminSetConfig", { key: "keys_open", value: true });
  });

  await step("订单：详情、确认到账后有会员和积分发放记录，退款撤回", async () => {
    const order = await okCall(user, "createOrder", { planId: "plan_member" });
    const pending = await okCall(admin, "adminOrder", { id: order.id });
    assert.equal(pending.status, "pending");
    assert.equal(pending.email, `user-${tag}@admin.local`);
    await okCall(admin, "adminConfirmOrder", { id: order.id, decision: "confirm" });
    const confirmed = await okCall(admin, "adminOrder", { id: order.id });
    assert.equal(confirmed.memberships.length, 1);
    assert.ok(confirmed.logs.some((l) => l.action === "order.confirm"));
    await okCall(admin, "adminRefundOrder", { id: order.id, note: "e2e" });
    const refunded = await okCall(admin, "adminOrder", { id: order.id });
    assert.equal(refunded.status, "refunded");
  });

  await step("APP 版本：无安装包显示不可下载；灰度 0% 和未到发布时间都不推送", async () => {
    assert.equal((await call(admin, "adminSaveRelease", { release: { versionName: "9.0.0", versionCode: 900, apkUrl: "https://example.invalid/a.apk" } })).status, 400);
    await okCall(admin, "adminSaveRelease", { release: { versionName: "2.0.0", versionCode: 200, notes: "base" } });
    let r = await okCall(user, "releaseCheck", { versionCode: 1 });
    assert.equal(r.release.versionCode, 200);
    assert.equal(r.release.downloadable, false);
    await okCall(admin, "adminSaveRelease", { release: { versionName: "3.0.0", versionCode: 300, rolloutPercent: 0 } });
    await okCall(admin, "adminSaveRelease", { release: { versionName: "4.0.0", versionCode: 400, publishedAt: new Date(Date.now() + 86_400_000).toISOString() } });
    r = await okCall(user, "releaseCheck", { versionCode: 1 });
    assert.equal(r.release.versionCode, 200, "灰度 0% 或未到时间的版本被推送了");
    const list = await okCall(admin, "adminReleases");
    assert.ok(list.some((x) => x.rolloutPercent === 0) && list.some((x) => x.publishedAt));
  });

  await step("系统开关：维护模式普通用户只读、管理员不受限；关闭下载和公告", async () => {
    await okCall(admin, "adminSaveAnnouncement", { title: "通知", body: "e2e 公告", active: true });
    assert.ok((await okCall(user, "me")).announcements.length >= 1);
    await okCall(admin, "adminSetConfig", { key: "announcements_enabled", value: false });
    assert.equal((await okCall(user, "me")).announcements.length, 0);
    await okCall(admin, "adminSetConfig", { key: "export_enabled", value: false });
    assert.equal((await call(user, "exportBundle", { projectId: doc.project.id })).status, 403);
    await okCall(admin, "adminSetConfig", { key: "maintenance_mode", value: true });
    assert.equal((await call(user, "listProjects")).status, 200);
    const w = await call(user, "saveProjectDoc", { doc, baseRevision: 1 });
    assert.equal(w.status, 503, JSON.stringify(w.json));
    assert.equal((await call(admin, "adminGrantQuota", { userId, kind: "export", delta: 1 })).status, 200);
    for (const key of ["maintenance_mode", "export_enabled", "announcements_enabled"]) await okCall(admin, "adminSetConfig", { key, value: key !== "maintenance_mode" });
    assert.equal((await call(user, "saveProjectDoc", { doc, baseRevision: 1 })).status, 200);
  });

  if (!process.env.BLUEOS_TOOLKIT_DIR || !process.env.DATABASE_URL) {
    skipped++;
    console.log("- 跳过构建管理（没有 BLUEOS_TOOLKIT_DIR / DATABASE_URL）");
  } else {
    const workers = new Set();
    const startWorker = (extra) => {
      const child = spawn(process.execPath, ["worker/build-worker.mjs"], { env: { ...process.env, WORKER_ID: `adm-${tag}-${workers.size}`, ...extra }, stdio: ["ignore", "ignore", "inherit"] });
      workers.add(child);
      return child;
    };
    const stop = async (child) => {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
      workers.delete(child);
    };
    const wait = async (id, done = ["succeeded", "failed", "cancelled"]) => {
      for (let i = 0; i < 240; i++) {
        const t = await okCall(admin, "adminBuild", { id });
        if (done.includes(t.status)) return t;
        await sleep(1000);
      }
      throw new Error("构建超时");
    };
    try {
      await okCall(admin, "adminSetConfig", { key: "build_enabled", value: true });
      let w = startWorker({ BUILD_TIMEOUT_SEC: "1" });
      let taskId = "";
      for (let i = 0; i < 30 && !taskId; i++) {
        const r = await call(user, "requestBuild", { projectId: doc.project.id });
        if (r.json?.status && r.json.status !== "unavailable") taskId = r.json.id;
        else await sleep(1000);
      }
      assert.ok(taskId, "Worker 没有上线");
      const quotaBefore = async () => (await okCall(user, "me")).quota.build;

      await step("构建管理：编译超时失败 → 预扣退回；后台看到日志、失败原因和 Worker/SDK 版本", async () => {
        const t = await wait(taskId);
        assert.equal(t.status, "failed");
        assert.equal(t.quotaState, "released");
        assert.deepEqual(t.ledger.map((l) => l.phase), ["reserve", "release"]);
        const board = await okCall(admin, "adminBuilds", {});
        assert.ok(board.failureReasons.length >= 1);
        assert.ok(board.workers.some((x) => /blueos-toolkit/.test(x.toolkit)));
      });

      await stop(w);
      w = startWorker({});
      const q0 = await quotaBefore();
      let retryId = "";
      await step("管理员重试：两个管理员同时点只建一个重试；成功后用户积分不变（不重复扣分）", async () => {
        const rs = await Promise.all([call(admin, "adminRetryBuild", { id: taskId }), call(admin, "adminRetryBuild", { id: taskId })]);
        const statuses = rs.map((r) => r.status).sort();
        assert.deepEqual(statuses, [200, 409], JSON.stringify(rs.map((r) => r.json)));
        retryId = rs.find((r) => r.status === 200).json.id;
        const t = await wait(retryId);
        assert.equal(t.status, "succeeded", t.error + t.log.slice(-500));
        assert.equal(t.quotaState, "waived");
        assert.equal(t.ledger.length, 0);
        assert.deepEqual(await quotaBefore(), q0);
        const mine = await okCall(user, "listBuilds", { projectId: doc.project.id });
        assert.ok(mine.some((x) => x.id === retryId && x.status === "succeeded"));
      });

      await step("后台下载产物，哈希与记录一致；成功任务不能再重试", async () => {
        const d = await okCall(admin, "adminDownloadBuild", { id: retryId });
        assert.equal(createHash("sha256").update(Buffer.from(d.rpkBase64, "base64")).digest("hex"), d.sha256);
        assert.equal((await call(admin, "adminRetryBuild", { id: retryId })).status, 409);
      });
      await stop(w);
    } finally {
      for (const child of workers) child.kill("SIGTERM");
    }
  }

  console.log(`\n${ok} 通过${skipped ? `，${skipped} 项跳过` : ""}（${BASE}）`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
