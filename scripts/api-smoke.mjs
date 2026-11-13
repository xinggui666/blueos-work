#!/usr/bin/env node
/**
 * 接口冒烟测试：对一个正在运行的服务（默认 http://127.0.0.1:8080）跑真实 HTTP 请求。
 * 用新的随机邮箱注册账号，所以可以对同一个库重复运行。
 *
 *   npm run dev            # 另一个终端
 *   npm run test:api       # 或 API_BASE=https://... node scripts/api-smoke.mjs
 *
 * 需要一个管理员账号来发卡密：设置 SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD；
 * 不设置时，假定这是一个空库，第一个注册的账号会成为超级管理员。
 */
import assert from "node:assert/strict";

const BASE = (process.env.API_BASE || "http://127.0.0.1:8080").replace(/\/+$/, "");
const ORIGIN = process.env.API_ORIGIN || "http://localhost:8080";
const H = { "content-type": "application/json", origin: ORIGIN };
const PASSWORD = "Smoke-Passw0rd!";
const tag = Date.now().toString(36);
let passed = 0;
let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✔ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✖ ${name}\n   ${error instanceof Error ? error.message : error}`);
  }
}

async function signUp(email, password = PASSWORD) {
  const up = await fetch(`${BASE}/api/auth/sign-up/email`, { method: "POST", headers: H, body: JSON.stringify({ email, password, name: email.split("@")[0] }) });
  await up.text();
  return signIn(email, password);
}

async function signIn(email, password = PASSWORD) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: H, body: JSON.stringify({ email, password }) });
  await res.text();
  const token = res.headers.get("set-auth-token");
  assert.ok(token, `登录 ${email} 没有拿到 token（HTTP ${res.status}）`);
  return token;
}

async function call(token, action, payload = {}, raw) {
  const res = await fetch(`${BASE}/api/v1/platform`, {
    method: "POST",
    headers: { ...H, authorization: `Bearer ${token}` },
    body: raw ?? JSON.stringify({ action, payload, client: "android" }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function project(id, type = "text") {
  return {
    id,
    name: "冒烟",
    appName: "冒烟",
    packageName: "com.smoke.watch",
    device: "watch-round",
    designWidth: 466,
    pages: [{ id: "page1", name: "Home", nodes: [{ id: "n1", type, name: "t", x: 10, y: 10, w: 100, h: 40, props: { text: "hi" }, actions: [] }] }],
    revisions: [],
  };
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
assert.ok(health?.ok, `服务不可用：${BASE}/api/health`);

const admin = process.env.SMOKE_ADMIN_EMAIL
  ? await signIn(process.env.SMOKE_ADMIN_EMAIL, process.env.SMOKE_ADMIN_PASSWORD)
  : await signUp(`admin-${tag}@smoke.local`);
const user = await signUp(`user-${tag}@smoke.local`);
const other = await signUp(`other-${tag}@smoke.local`);
const pid = (n) => `p${tag}${n}`.replace(/[^a-z0-9]/g, "").padEnd(8, "0").slice(0, 40);

await step("无效 token 返回 401", async () => {
  const r = await call("bogus", "me");
  assert.equal(r.status, 401);
});

await step("管理员可以看总览", async () => {
  const r = await call(admin, "adminOverview");
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

await step("新账号三种积分为 0、无角色", async () => {
  const r = await call(user, "me");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.roles, []);
  for (const kind of ["generation", "build", "export"]) assert.equal(r.json.quota[kind].balance, 0);
});

await step("普通用户调后台接口返回 403", async () => {
  const r = await call(user, "adminUsers");
  assert.equal(r.status, 403, JSON.stringify(r.json));
});

await step("未知操作返回 400", async () => {
  const r = await call(user, "noSuchAction");
  assert.equal(r.status, 400);
});

await step("非法 JSON 返回 400", async () => {
  const r = await call(user, "", {}, "{not json");
  assert.equal(r.status, 400);
});

await step("超大请求体返回 413", async () => {
  const r = await call(user, "", {}, JSON.stringify({ action: "syncProject", payload: { pad: "x".repeat(2_100_000) } }));
  assert.equal(r.status, 413);
});

await step("保存工程，别人不能覆盖", async () => {
  assert.equal((await call(user, "syncProject", { project: project(pid(1)) })).status, 200);
  const r = await call(other, "syncProject", { project: project(pid(1)) });
  assert.equal(r.status, 403, JSON.stringify(r.json));
});

await step("免费用户最多 3 个工程", async () => {
  assert.equal((await call(user, "syncProject", { project: project(pid(2)) })).status, 200);
  assert.equal((await call(user, "syncProject", { project: project(pid(3)) })).status, 200);
  const r = await call(user, "syncProject", { project: project(pid(4)) });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /最多保存 3 个工程/);
});

await step("0 积分不能下载 .bproj、不能申请 RPK", async () => {
  assert.equal((await call(user, "exportBundle", { projectId: pid(1) })).status, 400);
  assert.equal((await call(user, "requestBuild", { projectId: pid(1) })).status, 400);
});

let code = "";
await step("管理员生成积分卡密", async () => {
  const r = await call(admin, "adminCreateKeys", { type: "quota", quantity: 1, payload: { export: 3, build: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  code = r.json.codes[0];
  assert.match(code, /^BH-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

await step("卡密并发兑换只成功一次", async () => {
  const results = await Promise.all([call(user, "redeem", { code }), call(other, "redeem", { code }), call(user, "redeem", { code })]);
  assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.status).join(","));
});

const owner = (await call(user, "me")).json.quota.export.balance > 0 ? user : other;

await step("同一工程重复下载 .bproj 只扣一次", async () => {
  await call(owner, "syncProject", { project: project(pid(owner === user ? 1 : 5)) });
  const id = pid(owner === user ? 1 : 5);
  const before = (await call(owner, "me")).json.quota.export.balance;
  const a = await call(owner, "exportBundle", { projectId: id, project: project(id) });
  const b = await call(owner, "exportBundle", { projectId: id, project: project(id) });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.equal(b.json.reused, true);
  assert.equal(a.json.sha256, b.json.sha256);
  const after = (await call(owner, "me")).json.quota.export.balance;
  assert.equal(before - after, 1);
});

await step(".bproj 用服务端保存的内容，不信任客户端提交", async () => {
  const id = pid(owner === user ? 1 : 5);
  const r = await call(owner, "exportBundle", { projectId: id, project: project(id, "hotspot") });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const text = Buffer.from(r.json.zipBase64, "base64").toString("utf8");
  assert.ok(!text.includes("hotspot"), "导出包里出现了客户端篡改的组件");
});

await step("保存了未授权组件的工程不能导出", async () => {
  const id = pid(owner === user ? 2 : 6);
  await call(owner, "syncProject", { project: project(id, "hotspot") });
  const r = await call(owner, "exportBundle", { projectId: id });
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.match(r.json.error, /授权/);
});

await step("RPK 申请返回 unavailable 且不扣分", async () => {
  const id = pid(owner === user ? 1 : 5);
  const before = (await call(owner, "me")).json.quota.build;
  const r = await call(owner, "requestBuild", { projectId: id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "unavailable");
  assert.equal(r.json.charged, false);
  const after = (await call(owner, "me")).json.quota.build;
  assert.deepEqual(after, before);
});

await step("流水记录 reserve/commit", async () => {
  const r = await call(owner, "ledger");
  const phases = new Set(r.json.map((row) => row.phase));
  assert.ok(phases.has("reserve") && phases.has("commit"), [...phases].join(","));
});

console.log(`\n${passed} 通过，${failed} 失败（${BASE}）`);
process.exit(failed ? 1 : 0);
