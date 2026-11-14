#!/usr/bin/env node
/** MUTATES ONLY disposable local databases. No production execution. */
import assert from "node:assert/strict";
import pg from "pg";
import { spawnSync } from "node:child_process";
const BASE = process.env.API_BASE || "http://localhost:4011";
const url = new URL(process.env.DATABASE_URL || "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/blueos_v3_"))
  throw new Error("requires disposable blueos_v3_ local database");
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const H = { "content-type": "application/json", origin: BASE };
const PASSWORD = "V3-Disposable-Only-4011!";
const tag = Date.now().toString(36);
let pass = 0,
  fail = 0;
async function step(name, fn) {
  try {
    await fn();
    pass++;
    console.log("PASS", name);
  } catch (e) {
    fail++;
    console.error("FAIL", name, e.message);
  }
}
async function auth(email) {
  let r = await fetch(BASE + "/api/auth/sign-up/email", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password: PASSWORD, name: "V3 fixture" }),
  });
  await r.text();
  r = await fetch(BASE + "/api/auth/sign-in/email", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const token = r.headers.get("set-auth-token");
  assert.ok(token, `auth HTTP ${r.status}`);
  return token;
}
async function call(token, action, payload = {}) {
  const r = await fetch(BASE + "/api/v1/platform", {
    method: "POST",
    headers: { ...H, authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, payload, client: "web" }),
  });
  return { status: r.status, body: await r.json() };
}
async function ok(token, a, p) {
  const r = await call(token, a, p);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const attacker = await auth(`v3-outsider-${tag}@tests.invalid`);
const outsider = await ok(attacker, "me");
await step("explicit bootstrap prevents first outsider gaining super_admin", async () =>
  assert.deepEqual(outsider.roles, []),
);
const admin = await auth("v3-admin@tests.invalid");
let a = await ok(admin, "me");
if (process.env.V3_RED !== "true" && !a.roles.includes("super_admin")) {
  await step("unverified designated email alone cannot self-promote", async () =>
    assert.deepEqual(a.roles, []),
  );
  const result = spawnSync(
    process.execPath,
    ["scripts/bootstrap-admin.mjs", "--user-id", a.userId, "--email", "v3-admin@tests.invalid"],
    { env: process.env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  a = await ok(admin, "me");
}
if (process.env.V3_RED === "true") {
  // Historical no-config bootstrap is deliberately insecure. Fixture repair only lets
  // independent historical defects continue to reproduce; never counted as a pass.
  await db.query("delete from user_roles");
  await db.query("insert into user_roles(user_id,role) values($1,'super_admin')", [a.userId]);
  a = await ok(admin, "me");
}
await step("designated bootstrap is unique under concurrent calls", async () => {
  await Promise.all(Array.from({ length: 8 }, () => ok(admin, "me")));
  assert.ok(a.roles.includes("super_admin"));
  assert.equal(
    (await db.query("select count(*)::int as n from user_roles where role='super_admin'")).rows[0]
      .n,
    1,
  );
});
const user = await auth(`v3-member-${tag}@tests.invalid`),
  other = await auth(`v3-other-${tag}@tests.invalid`);
const u = await ok(user, "me"),
  b = await ok(other, "me");
await step("stale A request with B session rejected before profile/business writes", async () =>
  assert.equal((await call(other, "listProjects", { expectedUserId: u.userId })).status, 409),
);
let plan = {
  id: `v3plan${tag}`,
  slug: `v3plan${tag}`,
  name: "Original",
  priceCents: 199,
  durationDays: 30,
  generation: 3,
  build: 4,
  export: 5,
  concurrency: 2,
  projectLimit: 2,
  storageMb: 20,
  priority: 3,
  dailyBuild: 0,
  monthlyBuild: 0,
  bonusBuild: 0,
  categories: "",
  active: true,
};
await ok(admin, "adminSavePlan", { plan });
await step("future-only membership does not activate now", async () => {
  await db.query(
    "insert into memberships(id,user_id,plan_id,snapshot,starts_at,ends_at,source) values($1,$2,$3,$4,now()+interval '1 day',now()+interval '8 days','test-only')",
    [`future${tag}`, b.userId, plan.id, plan],
  );
  assert.equal((await ok(other, "me")).membership, null);
});
await db.query("delete from memberships where source='test-only'");
const order = await ok(user, "createOrder", { planId: plan.id });
plan = {
  ...plan,
  name: "ChangedBeforeConfirm",
  generation: 30,
  build: 40,
  export: 50,
  projectLimit: 1,
  concurrency: 1,
  priority: 9,
};
await ok(admin, "adminSavePlan", { plan });
await step("concurrent order confirmation grants exactly once", async () => {
  const results = await Promise.all([
    call(admin, "adminConfirmOrder", { id: order.id }),
    call(admin, "adminConfirmOrder", { id: order.id }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await db.query("select count(*)::int as n from memberships where source=$1", [
        `order:${order.id}`,
      ])
    ).rows[0].n,
    1,
  );
});
await step(
  "pending order confirmation uses original snapshot and original grant amounts",
  async () => {
    const me = await ok(user, "me");
    assert.equal(me.membership.snapshot.name, "Original");
    assert.equal(me.quota.generation.balance, 3);
    assert.equal(me.quota.build.balance, 4);
    assert.equal(me.quota.export.balance, 5);
  },
);
await step(
  "later plan edits cannot change active project/concurrency/priority entitlements",
  async () => {
    plan = { ...plan, projectLimit: 9, concurrency: 8, priority: 0 };
    await ok(admin, "adminSavePlan", { plan });
    const row = (
      await db.query(
        "select entitlement_project_limit,entitlement_concurrency,entitlement_priority from current_membership_entitlements where user_id=$1",
        [u.userId],
      )
    ).rows[0];
    assert.deepEqual(row, {
      entitlement_project_limit: 2,
      entitlement_concurrency: 2,
      entitlement_priority: 3,
    });
  },
);
await step("order and membership snapshots reject direct mutation", async () => {
  for (const table of ["orders", "memberships"]) {
    let rejected = false;
    try {
      await db.query(
        `update ${table} set snapshot=snapshot || '{"name":"tampered"}'::jsonb where user_id=$1`,
        [u.userId],
      );
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, table);
  }
});
plan = { ...plan, name: "FutureRenewal" };
await ok(admin, "adminSavePlan", { plan });
const renewal = await ok(user, "createOrder", { planId: plan.id });
await ok(admin, "adminConfirmOrder", { id: renewal.id });
await step("renewed future segment is not current before its start", async () =>
  assert.equal((await ok(user, "me")).membership.snapshot.name, "Original"),
);
await step("refunded future segment cannot activate, repeated refund rejected", async () => {
  await ok(admin, "adminRefundOrder", { id: renewal.id, note: "V3 regression" });
  assert.equal((await ok(user, "me")).membership.snapshot.name, "Original");
  assert.equal((await call(admin, "adminRefundOrder", { id: renewal.id })).status, 409);
});
await step("concurrent admin renewals append non-overlapping future intervals", async () => {
  await Promise.all([
    ok(admin, "adminGrantMembership", { userId: u.userId, planId: plan.id }),
    ok(admin, "adminGrantMembership", { userId: u.userId, planId: plan.id }),
  ]);
  const rows = (
    await db.query(
      "select starts_at,ends_at from memberships where user_id=$1 and source like 'admin:%' order by starts_at",
      [u.userId],
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.ok(+rows[0].ends_at <= +rows[1].starts_at);
});
await ok(admin, "adminSaveRelease", {
  release: {
    id: `v3rel${tag}`,
    versionName: "V3-Test",
    versionCode: 10,
    minVersionCode: 9,
    force: true,
    active: true,
    rolloutPercent: 100,
  },
});
await step("same/newer app version not forced into same-version update deadlock", async () => {
  for (const versionCode of [10, 11])
    assert.equal((await ok(user, "releaseCheck", { versionCode })).force, false);
  assert.equal((await ok(user, "releaseCheck", { versionCode: 8 })).force, true);
});
await step("inconsistent minimum/latest release configuration rejected", async () =>
  assert.equal(
    (
      await call(admin, "adminSaveRelease", {
        release: { versionName: "bad", versionCode: 5, minVersionCode: 9, active: true },
      })
    ).status,
    400,
  ),
);
const pid = `v3project${tag}`;
const project = {
  id: pid,
  name: "V3 delivery",
  appName: "V3 delivery",
  packageName: "com.v3.test",
  device: "watch-round",
  designWidth: 466,
  pages: [{ id: "page1", name: "Home", nodes: [] }],
  revisions: [],
};
const saved = await ok(user, "syncProject", { project });
assert.equal(saved.ok, true);
await step("delivery requires an explicit confirmed revision (no legacy bypass)", async () => {
  for (const action of ["exportBundle", "requestBuild"])
    assert.equal((await call(user, action, { projectId: pid })).status, 428);
});
await step("stale export and build receipts reject before billing or task creation", async () => {
  const before = await ok(user, "me");
  for (const action of ["exportBundle", "requestBuild"]) {
    const r = await call(user, action, { projectId: pid, expectedRevision: saved.revision + 1 });
    assert.equal(r.status, 409, action + JSON.stringify(r.body));
  }
  assert.deepEqual((await ok(user, "me")).quota, before.quota);
});
await step("fixed revision export is idempotent", async () => {
  const before = (await ok(user, "me")).quota.export;
  const first = await ok(user, "exportBundle", {
    projectId: pid,
    expectedRevision: saved.revision,
  });
  const second = await ok(user, "exportBundle", {
    projectId: pid,
    expectedRevision: saved.revision,
  });
  assert.equal(first.sha256, second.sha256);
  assert.equal(second.reused, true);
  assert.equal((await ok(user, "me")).quota.export.balance, before.balance - 1);
});
await db.end();
console.log(
  JSON.stringify({ pass, fail, environment: "local PostgreSQL + actual HTTP API", base: BASE }),
);
if (fail) process.exitCode = 1;
