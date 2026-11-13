#!/usr/bin/env node
/**
 * RPK 构建端到端（阶段 4）：真实服务 + 真实 Worker + 官方工具链，空库运行。
 *
 *   DATABASE_URL=...（与服务同一个库） BLUEOS_TOOLKIT_DIR=/opt/blueos-toolkit [BLUEOS_RPK_SIGN_DIR=...] \
 *   API_BASE=http://localhost:8099 node scripts/e2e/build-rpk.mjs
 *
 * 覆盖：后台未开启 → 不可用不扣分；积分不足拒绝；预扣 → 编译 → 产物检查 → 确认扣分 → 下载 RPK；
 * 双击/并发请求只建一个任务只预扣一次；编译超时失败释放预扣；排队中取消释放预扣。
 * 本脚本自己启动/停止 Worker 子进程。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { counterDoc } from "../../src/lib/protocol/fixtures.ts";
import { readZipEntries } from "../../worker/rpk.mjs";

const BASE = (process.env.API_BASE || "http://localhost:8080").replace(/\/+$/, "");
const H = { "content-type": "application/json", origin: process.env.API_ORIGIN || BASE };
const tag = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const step = async (name, fn) => {
  await fn();
  ok++;
  console.log(`✔ ${name}`);
};

async function signUp(email) {
  await (await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "Build-Passw0rd!", name: email.split("@")[0] }) })).text();
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "Build-Passw0rd!" }) });
  await res.text();
  return res.headers.get("set-auth-token");
}
async function call(token, action, payload = {}) {
  const res = await fetch(`${BASE}/api/v1/platform`, { method: "POST", headers: { ...H, authorization: `Bearer ${token}` }, body: JSON.stringify({ action, payload, client: "web" }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const workers = new Set();
function startWorker(extra = {}, name = "worker") {
  const child = spawn(process.execPath, ["worker/build-worker.mjs"], { env: { ...process.env, WORKER_ID: `${name}-${tag}`, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stdout.write(`[${name}!] ${d}`));
  workers.add(child);
  return child;
}
async function stopWorker(child) {
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  workers.delete(child);
}
async function waitStatus(token, id, done = ["succeeded", "failed", "cancelled"], ms = 180_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await call(token, "getBuild", { id });
    if (done.includes(r.json?.status)) return r.json;
    await sleep(1000);
  }
  throw new Error(`任务 ${id} 超时未结束`);
}
const quota = async (token) => (await call(token, "me")).json.quota.build;

const admin = await signUp(`admin-${tag}@build.local`);
await call(admin, "me"); // 空库：第一个调用接口的账号成为超级管理员
const user = await signUp(`user-${tag}@build.local`);
const userId = (await call(user, "me")).json.userId;
const doc = counterDoc();
doc.project.id = `jb${tag}`.replace(/[^a-z0-9]/g, "");
let revision = 0;
async function save(mutate) {
  if (mutate) mutate(doc);
  const r = await call(user, "saveProjectDoc", { doc, baseRevision: revision });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  revision = r.json.revision;
}

try {
  await save();

  await step("后台未开启：不可用，不扣分", async () => {
    const r = await call(user, "requestBuild", { projectId: doc.project.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.status, "unavailable");
    assert.deepEqual(await quota(user), { balance: 0, reserved: 0 });
  });

  assert.equal((await call(admin, "adminSetConfig", { key: "build_enabled", value: true })).status, 200);

  await step("开启但没有在线 Worker：不可用，不扣分", async () => {
    const r = await call(user, "requestBuild", { projectId: doc.project.id });
    assert.equal(r.json.status, "unavailable", JSON.stringify(r.json));
    assert.match(r.json.message, /Worker/);
  });

  let worker = startWorker();
  for (let i = 0; i < 30; i++) {
    const r = await call(user, "requestBuild", { projectId: doc.project.id });
    if (r.status === 400) break; // Worker 已在线，进入积分检查
    await sleep(1000);
  }

  await step("积分不足：拒绝，不建任务", async () => {
    const r = await call(user, "requestBuild", { projectId: doc.project.id });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /积分不足/);
    const list = (await call(user, "listBuilds", { projectId: doc.project.id })).json;
    assert.ok(list.every((t) => t.status === "unavailable"));
  });

  assert.equal((await call(admin, "adminGrantQuota", { userId, kind: "build", delta: 3 })).status, 200);

  let taskId = "";
  await step("并发 3 次请求：只建 1 个任务，只预扣 1 个积分", async () => {
    const rs = await Promise.all([1, 2, 3].map(() => call(user, "requestBuild", { projectId: doc.project.id })));
    for (const r of rs) assert.equal(r.status, 200, JSON.stringify(r.json));
    const ids = new Set(rs.map((r) => r.json.id));
    assert.equal(ids.size, 1, [...ids].join(","));
    taskId = rs[0].json.id;
    assert.ok(["waiting", "running", "succeeded"].includes(rs[0].json.status));
    const q = await quota(user);
    assert.equal(q.balance, 3);
    assert.ok(q.reserved <= 1);
  });

  await step("官方工具链编译成功：产物检查通过，确认扣 1 分", async () => {
    const t = await waitStatus(user, taskId);
    assert.equal(t.status, "succeeded", `${t.error}\n${t.log}`);
    assert.equal(t.verify.ok, true, JSON.stringify(t.verify));
    assert.match(t.toolkit, /blueos-toolkit/);
    assert.equal(t.revision, revision);
    assert.equal(t.quotaState, "committed");
    assert.deepEqual(await quota(user), { balance: 2, reserved: 0 });
    const ledger = (await call(user, "ledger")).json.filter((row) => row.ref === taskId).map((row) => row.phase);
    assert.deepEqual(ledger.sort(), ["commit", "reserve"]);
    console.log(`   ${t.artifactName} ${t.artifactBytes} 字节 ${t.mode} sha256=${t.artifactSha256}`);
  });

  await step("下载 RPK：SHA-256 一致，包内含编译后的页面和 count + 1 逻辑，下载不再扣分", async () => {
    const r = await call(user, "downloadBuild", { id: taskId });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const buf = Buffer.from(r.json.rpkBase64, "base64");
    assert.equal(createHash("sha256").update(buf).digest("hex"), r.json.sha256);
    const entries = readZipEntries(buf);
    const manifest = JSON.parse(entries.find((e) => e.name === "manifest.json").data().toString());
    assert.equal(manifest.package, "com.example.counter");
    const vru = entries.find((e) => e.name === "com.example.counter.vru").data();
    assert.ok(vru.includes(Buffer.from("count + 1")));
    assert.ok(vru.includes(Buffer.from("pages/Home")) && vru.includes(Buffer.from("pages/Two")));
    if (process.env.E2E_RPK_OUT) (await import("node:fs")).writeFileSync(process.env.E2E_RPK_OUT, buf);
    assert.deepEqual(await quota(user), { balance: 2, reserved: 0 });
    const again = await call(user, "requestBuild", { projectId: doc.project.id });
    assert.equal(again.json.id, taskId, "同一修订已成功，不重复构建扣分");
  });

  await step("编译超时：失败，释放预扣，不扣分", async () => {
    await stopWorker(worker);
    worker = startWorker({ BUILD_TIMEOUT_SEC: "1" }, "slow");
    await sleep(1500);
    await save((d) => (d.pages[0].components[0].props.value = "超时"));
    const r = await call(user, "requestBuild", { projectId: doc.project.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const t = await waitStatus(user, r.json.id);
    assert.equal(t.status, "failed");
    assert.match(t.error, /超时/);
    assert.equal(t.quotaState, "released");
    assert.deepEqual(await quota(user), { balance: 2, reserved: 0 });
  });

  await step("排队中取消：已取消，释放预扣", async () => {
    await stopWorker(worker);
    worker = startWorker({ BUILD_POLL_MS: "60000" }, "idle");
    await sleep(2500);
    await save((d) => (d.pages[0].components[0].props.value = "取消"));
    const r = await call(user, "requestBuild", { projectId: doc.project.id });
    assert.equal(r.json.status, "waiting", JSON.stringify(r.json));
    assert.deepEqual(await quota(user), { balance: 2, reserved: 1 });
    const c = await call(user, "cancelBuild", { id: r.json.id });
    assert.equal(c.json.status, "cancelled", JSON.stringify(c.json));
    assert.deepEqual(await quota(user), { balance: 2, reserved: 0 });
    const again = await call(user, "cancelBuild", { id: r.json.id });
    assert.equal(again.status, 409);
    assert.deepEqual(await quota(user), { balance: 2, reserved: 0 });
  });

  await step("别人的任务看不到也下载不了", async () => {
    const other = await signUp(`other-${tag}@build.local`);
    assert.equal((await call(other, "getBuild", { id: taskId })).status, 404);
    assert.equal((await call(other, "downloadBuild", { id: taskId })).status, 404);
  });

  console.log(`\n${ok} 通过（${BASE}）`);
} catch (error) {
  console.log(`✖ ${error instanceof Error ? error.stack : error}`);
  process.exitCode = 1;
} finally {
  for (const w of workers) w.kill("SIGTERM");
}
