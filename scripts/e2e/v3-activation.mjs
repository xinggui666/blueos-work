#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";
import { spawnSync } from "node:child_process";
const BASE = process.env.API_BASE || "http://localhost:4019",
  url = new URL(process.env.DATABASE_URL || "");
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.startsWith("/blueos_v3_") ||
  !["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)
)
  throw Error("local disposable V3 fixtures only");
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const H = { "content-type": "application/json", origin: BASE },
  password = "V3-Disposable-Only-4011!",
  tag = Date.now().toString(36);
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
  await fetch(BASE + "/api/auth/sign-up/email", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password, name: "Activation fixture" }),
  });
  const r = await fetch(BASE + "/api/auth/sign-in/email", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  const token = r.headers.get("set-auth-token");
  assert.ok(token);
  return token;
}
async function call(token, action, payload = {}) {
  const r = await fetch(BASE + "/api/v1/platform", {
    method: "POST",
    headers: { ...H, authorization: "Bearer " + token },
    body: JSON.stringify({ action, payload, client: "android" }),
  });
  return { status: r.status, body: await r.json() };
}
async function ok(t, a, p) {
  const r = await call(t, a, p);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const balance = async (t) => {
  const m = await ok(t, "me");
  return Object.fromEntries(["generation", "build", "export"].map((k) => [k, m.quota[k].balance]));
};
try {
  const admin = await auth("v3-admin@tests.invalid");
  let a = await ok(admin, "me");
  if (!a.roles.includes("super_admin")) {
    const r = spawnSync(
      process.execPath,
      ["scripts/bootstrap-admin.mjs", "--user-id", a.userId, "--email", "v3-admin@tests.invalid"],
      { env: process.env, encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    a = await ok(admin, "me");
  }
  const user = await auth(`activation-${tag}@tests.invalid`),
    u = await ok(user, "me");
  const plan = {
    id: "activation" + tag,
    slug: "activation" + tag,
    name: "Frozen activation",
    priceCents: 123,
    durationDays: 30,
    generation: 3,
    build: 4,
    export: 5,
    bonusBuild: 2,
    monthlyBuild: 9,
    dailyBuild: 8,
    concurrency: 1,
    projectLimit: 10,
    storageMb: 20,
    priority: 0,
    categories: "",
    active: true,
  };
  await ok(admin, "adminSavePlan", { plan });
  const order = async () => {
    const o = await ok(user, "createOrder", { planId: plan.id });
    await ok(admin, "adminConfirmOrder", { id: o.id });
    return o.id;
  };
  await order();
  await step("active segment grants one-time build+bonus, never monthly/daily fields", async () =>
    assert.deepEqual(await balance(user), { generation: 3, build: 6, export: 5 }),
  );
  const beforeFuture = await balance(user),
    second = await order();
  await step(
    "confirmed future segment has no grant or balance change before starts_at",
    async () => {
      assert.deepEqual(await balance(user), beforeFuture);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from quota_ledger where ref=$1 and phase='grant'",
            ["order:" + second],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query("select credits_state from memberships where source=$1", [
            "order:" + second,
          ])
        ).rows[0].credits_state,
        "pending",
      );
    },
  );
  if (process.env.V3_ACTIVATION_RED_ONLY !== "true") {
    await ok(admin, "adminSavePlan", {
      plan: { ...plan, generation: 30, build: 40, export: 50, bonusBuild: 20, monthlyBuild: 90 },
    });
    await db.query(
      "update memberships set starts_at=now()-interval '1 second',ends_at=now()+interval '30 days' where source=$1",
      ["order:" + second],
    );
    await step(
      "concurrent lazy activation grants frozen snapshot exactly once despite plan edits",
      async () => {
        await Promise.all(Array.from({ length: 10 }, () => ok(user, "me")));
        assert.deepEqual(await balance(user), { generation: 6, build: 12, export: 10 });
        assert.equal(
          (
            await db.query(
              "select count(*)::int as n from quota_ledger where ref=$1 and phase='grant'",
              ["order:" + second],
            )
          ).rows[0].n,
          3,
        );
        assert.equal(
          (
            await db.query("select credits_state from memberships where source=$1", [
              "order:" + second,
            ])
          ).rows[0].credits_state,
          "applied",
        );
      },
    );
    const third = await order(),
      beforeRefund = await balance(user);
    await ok(admin, "adminRefundOrder", { id: third });
    await db.query("update memberships set starts_at=now()-interval '1 day' where source=$1", [
      "order:" + third,
    ]);
    await step(
      "refund before activation permanently cancels all future one-time grants",
      async () => {
        await Promise.all(Array.from({ length: 5 }, () => ok(user, "me")));
        assert.deepEqual(await balance(user), beforeRefund);
        assert.equal(
          (
            await db.query(
              "select count(*)::int as n from quota_ledger where ref=$1 and phase='grant'",
              ["order:" + third],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.query("select credits_state from memberships where source=$1", [
              "order:" + third,
            ])
          ).rows[0].credits_state,
          "revoked",
        );
        assert.equal((await call(admin, "adminRefundOrder", { id: third })).status, 409);
      },
    );
    const fourth = await order(),
      beforeRace = await balance(user);
    await db.query("update memberships set starts_at=now()-interval '1 second' where source=$1", [
      "order:" + fourth,
    ]);
    await step("activation/refund concurrency cannot leave a credited refunded order", async () => {
      await Promise.all([
        ...Array.from({ length: 6 }, () => ok(user, "me")),
        ok(admin, "adminRefundOrder", { id: fourth }),
      ]);
      assert.deepEqual(await balance(user), beforeRace);
      const rows = (
        await db.query(
          "select kind,sum(delta)::int as total from quota_ledger where ref=any($1) group by kind",
          [["order:" + fourth, "refund:" + fourth]],
        )
      ).rows;
      for (const r of rows) assert.equal(r.total, 0);
    });
    const fifth = await order(),
      beforeLate = await balance(user);
    await db.query(
      "update memberships set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where source=$1",
      ["order:" + fifth],
    );
    await step(
      "one-time due credits catch up after downtime even if segment expired; no monthly award",
      async () =>
        assert.deepEqual(await balance(user), {
          generation: beforeLate.generation + 30,
          build: beforeLate.build + 60,
          export: beforeLate.export + 50,
        }),
    );
    await step(
      "corrupt pending snapshot fails atomically without partial balances/ledger",
      async () => {
        const before = await balance(user);
        await db.query(
          "insert into memberships(id,user_id,plan_id,snapshot,starts_at,ends_at,source,credits_state) values($1,$2,$3,$4,now(),now()+interval '1 day',$1,'pending')",
          [
            "bad" + tag,
            u.userId,
            plan.id,
            { generation: "broken", build: 4, export: 5, bonusBuild: 2 },
          ],
        );
        await assert.rejects(
          db.query("select activate_membership_credits($1)", [u.userId]),
          /invalid membership/,
        );
        assert.equal(
          (
            await db.query("select count(*)::int as n from quota_ledger where ref=$1", [
              "bad" + tag,
            ])
          ).rows[0].n,
          0,
        );
        assert.equal(
          (await db.query("select credits_state from memberships where id=$1", ["bad" + tag]))
            .rows[0].credits_state,
          "pending",
        );
        await db.query("delete from memberships where id=$1", ["bad" + tag]);
        assert.deepEqual(await balance(user), before);
      },
    );
    await step(
      "legacy eagerly credited rows default applied and are never credited again",
      async () => {
        const legacy = await auth(`legacy-activation-${tag}@tests.invalid`),
          l = await ok(legacy, "me");
        await db.query(
          "insert into memberships(id,user_id,plan_id,snapshot,starts_at,ends_at,source) values($1,$2,$3,$4,now()-interval '1 day',now()+interval '1 day',$1)",
          ["old" + tag, l.userId, plan.id, plan],
        );
        assert.deepEqual(await balance(legacy), { generation: 0, build: 0, export: 0 });
        assert.equal(
          (await db.query("select credits_state from memberships where id=$1", ["old" + tag]))
            .rows[0].credits_state,
          "applied",
        );
      },
    );
    await step(
      "exact activation boundary inclusive and repeated policy calls idempotent",
      async () => {
        await db.query("begin");
        try {
          await db.query(
            "insert into memberships(id,user_id,plan_id,snapshot,starts_at,ends_at,source,credits_state) values($1,$2,$3,$4,now()+interval '1 microsecond',now()+interval '1 day',$1,'pending')",
            ["boundary" + tag, "boundary-user" + tag, plan.id, plan],
          );
          assert.equal(
            (await db.query("select activate_membership_credits($1) as n", ["boundary-user" + tag]))
              .rows[0].n,
            0,
          );
          await db.query("update memberships set starts_at=now() where id=$1", ["boundary" + tag]);
          assert.equal(
            (await db.query("select activate_membership_credits($1) as n", ["boundary-user" + tag]))
              .rows[0].n,
            1,
          );
          assert.equal(
            (await db.query("select activate_membership_credits($1) as n", ["boundary-user" + tag]))
              .rows[0].n,
            0,
          );
        } finally {
          await db.query("rollback");
        }
      },
    );
  }
  console.log(
    JSON.stringify({
      pass,
      fail,
      base: BASE,
      redOnly: process.env.V3_ACTIVATION_RED_ONLY === "true",
    }),
  );
  if (fail) process.exitCode = 1;
} finally {
  await db.end();
}
