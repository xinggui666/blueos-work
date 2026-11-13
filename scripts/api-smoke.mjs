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
  assert.equal(r.status, 403);
  assert.match(r.json.error, /最多保存 3 个工程/);
});

await step("0 积分不能下载 .bproj；构建未开放时 RPK 申请记为不可用且不扣分", async () => {
  assert.equal((await call(user, "exportBundle", { projectId: pid(1) })).status, 400);
  // 构建开关默认关闭：记录一条“不可用”任务，不预扣、不报成功（积分不足的 400 在 build-rpk e2e 里覆盖）。
  const r = await call(user, "requestBuild", { projectId: pid(1) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, "unavailable");
  assert.equal(r.json.charged, false);
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

await step("并发重复下载同一工程只扣一次", async () => {
  const id = pid(owner === user ? 3 : 7);
  await call(owner, "syncProject", { project: project(id) });
  const grant = await call(admin, "adminGrantQuota", { userId: (await call(owner, "me")).json.userId, kind: "export", delta: 3 });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  const before = (await call(owner, "me")).json.quota.export.balance;
  const results = await Promise.all([1, 2, 3].map(() => call(owner, "exportBundle", { projectId: id })));
  assert.ok(results.every((r) => r.status === 200), results.map((r) => r.status + JSON.stringify(r.json?.error ?? "")).join(","));
  const after = (await call(owner, "me")).json.quota.export.balance;
  assert.equal(before - after, 1);
});

await step("订单：并发确认只开通一次，撤销只扣回本订单", async () => {
  const buyer = await signUp(`buyer-${tag}@smoke.local`);
  const plans = (await call(buyer, "me")).json.plans;
  const plan = plans.find((p) => p.export > 0) || plans[0];
  const created = await call(buyer, "createOrder", { planId: plan.id });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const confirms = await Promise.all([1, 2].map(() => call(admin, "adminConfirmOrder", { id: created.json.id, decision: "confirm" })));
  assert.deepEqual(confirms.map((r) => r.status).sort(), [200, 409]);
  const me1 = (await call(buyer, "me")).json;
  assert.ok(me1.membership, "确认后应该有会员");
  assert.equal(me1.quota.export.balance, plan.export);
  const refund = await call(admin, "adminRefundOrder", { id: created.json.id });
  assert.equal(refund.status, 200, JSON.stringify(refund.json));
  const me2 = (await call(buyer, "me")).json;
  assert.equal(me2.membership, null);
  assert.equal(me2.quota.export.balance, 0);
  assert.equal((await call(admin, "adminRefundOrder", { id: created.json.id })).status, 409);
});

await step("封禁立即吊销会话，解封后可重新登录", async () => {
  const email = `banned-${tag}@smoke.local`;
  const victim = await signUp(email);
  const victimId = (await call(victim, "me")).json.userId;
  assert.equal((await call(admin, "adminSetStatus", { userId: victimId, status: "banned" })).status, 200);
  const after = await call(victim, "me");
  assert.ok(after.status === 401 || after.status === 403, String(after.status));
  assert.equal((await call(admin, "adminSetStatus", { userId: victimId, status: "active" })).status, 200);
  const again = await signIn(email);
  assert.equal((await call(again, "me")).status, 200);
});

await step("管理员不能封禁自己", async () => {
  const adminId = (await call(admin, "me")).json.userId;
  assert.equal((await call(admin, "adminSetStatus", { userId: adminId, status: "banned" })).status, 400);
});

/* ---------------- 统一协议 v2 ---------------- */
const proto = await signUp(`proto-${tag}@smoke.local`);
const ppid = `q${tag}`.replace(/[^a-z0-9]/g, "").padEnd(8, "0");
let doc = null;

await step("旧版编辑器格式保存后，以协议 v2 读取（修订 1）", async () => {
  const s1 = await call(proto, "syncProject", { project: project(ppid) });
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  assert.equal(s1.json.revision, 1);
  const r = await call(proto, "getProjectDoc", { projectId: ppid });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.doc.format, "blueos-workshop-project");
  assert.equal(r.json.doc.schemaVersion, 2);
  assert.equal(r.json.revision, 1);
  assert.match(r.json.contentSha256, /^[0-9a-f]{64}$/);
  doc = r.json.doc;
});

await step("内容不变不产生新修订；内容变化修订 +1", async () => {
  const same = await call(proto, "saveProjectDoc", { doc, baseRevision: 1 });
  assert.equal(same.status, 200, JSON.stringify(same.json));
  assert.equal(same.json.changed, false);
  assert.equal(same.json.revision, 1);
  doc.variables.push({ id: "vcount", key: "count", type: "int", default: 0, scope: "global", persist: false });
  doc.events.push({ id: "eclick", enabled: true, trigger: { kind: "component", componentId: "n1", event: "click" }, condition: "count < 5", actions: [{ id: "ainc", kind: "setVar", variableId: "vcount", value: "count + 1" }] });
  const r = await call(proto, "saveProjectDoc", { doc, baseRevision: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.revision, 2);
  assert.deepEqual(r.json.issues.filter((i) => i.level === "error"), []);
});

await step("基于旧修订保存不同内容 → 409，返回云端版本，不覆盖", async () => {
  const stale = structuredClone(doc);
  stale.project.name = "另一台设备";
  const r = await call(proto, "saveProjectDoc", { doc: stale, baseRevision: 1 });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.conflict, true);
  assert.equal(r.json.serverRevision, 2);
  assert.equal(r.json.serverDoc.events.length, 1);
  const now = await call(proto, "getProjectDoc", { projectId: ppid });
  assert.equal(now.json.doc.project.name, "冒烟");
});

await step("网页编辑器格式往返保留协议扩展内容（条件事件）", async () => {
  const list = await call(proto, "listProjects");
  const p = list.json.find((x) => x.id === ppid);
  assert.ok(p?.protocolExtras, "缺少 protocolExtras");
  assert.equal(p.protocolExtras.revision, 2);
  p.name = "网页改名";
  const s = await call(proto, "syncProject", { project: p });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.revision, 3);
  const r = await call(proto, "getProjectDoc", { projectId: ppid });
  assert.equal(r.json.doc.events[0].condition, "count < 5");
  assert.equal(r.json.doc.project.name, "网页改名");
});

await step("网页旧修订保存 → 返回冲突和云端工程，不覆盖", async () => {
  const list = await call(proto, "listProjects");
  const p = list.json.find((x) => x.id === ppid);
  p.protocolExtras.revision = 1;
  p.name = "旧标签页";
  const s = await call(proto, "syncProject", { project: p });
  assert.equal(s.status, 200);
  assert.equal(s.json.conflict, true);
  assert.equal(s.json.serverProject.name, "网页改名");
});

await step("可以读取历史修订和修订列表", async () => {
  const revs = await call(proto, "listRevisions", { projectId: ppid });
  assert.equal(revs.status, 200);
  assert.deepEqual(revs.json.filter((r) => r.source === "save").map((r) => r.revision), [3, 2, 1]);
  const old = await call(proto, "getProjectDoc", { projectId: ppid, revision: 1 });
  assert.equal(old.json.doc.events.length, 0);
  assert.equal((await call(other, "getProjectDoc", { projectId: ppid })).status, 404);
  assert.equal((await call(other, "listRevisions", { projectId: ppid })).status, 404);
});

await step("结构错误的协议文档保存返回 400", async () => {
  const bad = structuredClone(doc);
  bad.pages[0].components[0].layout = "x";
  const r = await call(proto, "saveProjectDoc", { doc: bad, baseRevision: 3 });
  assert.equal(r.status, 400, JSON.stringify(r.json));
});

await step("validateProject 报告语义错误", async () => {
  const bad = structuredClone(doc);
  bad.events[0].actions.push({ id: "anav", kind: "navigate", pageId: "nopage" });
  const r = await call(proto, "validateProject", { doc: bad });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, false);
  assert.ok(r.json.issues.some((i) => /页面不存在/.test(i.message)));
});

await step(".bproj v2：导出 → 预览 → 导入为新工程；重复导入识别；篡改拒绝", async () => {
  const meId = (await call(proto, "me")).json.userId;
  assert.equal((await call(admin, "adminGrantQuota", { userId: meId, kind: "export", delta: 2 })).status, 200);
  const ex = await call(proto, "exportBundle", { projectId: ppid });
  assert.equal(ex.status, 200, JSON.stringify(ex.json));
  const pv = await call(proto, "previewImport", { fileBase64: ex.json.zipBase64 });
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  assert.equal(pv.json.integrity, "verified");
  assert.equal(pv.json.summary.events, 1);
  assert.equal(pv.json.duplicateOf, ppid);
  const dup = await call(proto, "importBundle", { fileBase64: ex.json.zipBase64 });
  assert.equal(dup.json.duplicate, true);
  // 删一个工程腾出名额，再以副本导入
  const copy = await call(proto, "importBundle", { fileBase64: ex.json.zipBase64, mode: "copy" });
  assert.equal(copy.status, 200, JSON.stringify(copy.json));
  assert.equal(copy.json.imported, true);
  assert.notEqual(copy.json.projectId, ppid);
  const bytes = Buffer.from(ex.json.zipBase64, "base64");
  const i = bytes.indexOf(Buffer.from("网页改名"));
  bytes[i + 1] ^= 1;
  const bad = await call(proto, "previewImport", { fileBase64: bytes.toString("base64") });
  assert.equal(bad.json.ok, false);
  assert.equal(bad.json.integrity, "failed");
  const badImport = await call(proto, "importBundle", { fileBase64: bytes.toString("base64"), mode: "copy" });
  assert.equal(badImport.status, 400);
});

console.log(`\n${passed} 通过，${failed} 失败（${BASE}）`);
process.exit(failed ? 1 : 0);
