#!/usr/bin/env node
/** Upgrade/interval policy verification ONLY on local disposable V3 databases. */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { spawnSync } from "node:child_process";
const url = new URL(process.env.DATABASE_URL || "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/blueos_v3_"))
  throw Error("disposable local V3 database required");
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  if (process.env.V3_MIGRATION_PREPARE_OLD === "true") {
    const tables = await db.query(
      "select table_name from information_schema.tables where table_schema='public'",
    );
    assert.equal(
      tables.rowCount,
      0,
      "old fixture preparation requires a completely empty database",
    );
    await db.query(
      "create table _migrations(name text primary key, applied_at timestamptz default now())",
    );
    for (const name of (await readdir("migrations"))
      .filter((n) => /^000[1-7]_.*\.sql$/.test(n))
      .sort()) {
      await db.query(await readFile("migrations/" + name, "utf8"));
      await db.query("insert into _migrations(name) values($1)", [name]);
    }
    await db.query(`insert into "user"(id,name,email,"emailVerified") values
      ('legacy-owner','Legacy fixture','legacy-owner@tests.invalid',false),
      ('boundary-owner','Boundary fixture','boundary-owner@tests.invalid',false)`);
    await db.query("insert into profiles(user_id) values('legacy-owner'),('boundary-owner')");
    const plan = (await db.query("select id from plans limit 1")).rows[0];
    assert.ok(plan, "legacy migration must seed at least one plan");
    const snapshot = {
      id: plan.id,
      name: "legacy snapshot",
      projectLimit: 7,
      concurrency: 2,
      customPreserved: "unchanged",
    };
    await db.query(
      "insert into memberships(id,user_id,plan_id,snapshot,starts_at,ends_at,source) values('legacy-member','legacy-owner',$1,$2,now()-interval '1 day',now()+interval '30 days','legacy-fixture')",
      [plan.id, snapshot],
    );
    await db.query(
      "insert into orders(id,user_id,plan_id,status,amount_cents,snapshot) values('legacy-order','legacy-owner',$1,'pending',123,$2)",
      [plan.id, snapshot],
    );
    console.log(
      "Prepared nonempty 0001..0007 fixture: legacy membership with preserved custom fields and order",
    );
  }
  const ordersBefore = (await db.query("select id,snapshot from orders order by id")).rows;
  const before = (await db.query("select id,snapshot from memberships")).rows;
  const counts = async () => {
    const out = {};
    for (const table of [
      "user",
      "projects",
      "orders",
      "memberships",
      "quota_accounts",
      "quota_ledger",
    ])
      out[table] = (await db.query(`select count(*)::int as n from "${table}"`)).rows[0].n;
    return out;
  };
  const prior = await counts();
  const run = () =>
    spawnSync(process.execPath, ["scripts/migrate.mjs"], { env: process.env, encoding: "utf8" });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  console.log(result.stdout.trim());
  assert.deepEqual(
    (await db.query("select id,snapshot from orders order by id")).rows,
    ordersBefore,
  );
  const after = new Map(
    (await db.query("select id,snapshot from memberships")).rows.map((r) => [r.id, r.snapshot]),
  );
  for (const row of before)
    for (const [key, value] of Object.entries(row.snapshot))
      assert.deepEqual(after.get(row.id)[key], value);
  assert.deepEqual(await counts(), prior);
  console.log(
    "PASS populated upgrade preserves every existing snapshot field and business row count; only absent historical fields backfilled",
  );
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /up to date/);
  console.log("PASS repeat migration is up to date");
  const user = (
    await db.query(
      'select id from "user" u where not exists(select 1 from memberships m where m.user_id=u.id) limit 1',
    )
  ).rows[0];
  const plan = (await db.query("select id from plans limit 1")).rows[0];
  assert.ok(user && plan);
  await db.query("begin");
  const insert = (start, end) =>
    db.query(
      `insert into memberships(id,user_id,plan_id,snapshot,starts_at,ends_at,source) values('v3boundary',$1,$2,'{}',${start},${end},'interval-fixture')`,
      [user.id, plan.id],
    );
  const active = async () =>
    (
      await db.query(
        "select count(*)::int as n from current_membership_entitlements where user_id=$1",
        [user.id],
      )
    ).rows[0].n;
  await insert("now()", "now()+interval '1 day'");
  assert.equal(await active(), 1);
  await db.query("delete from memberships where id='v3boundary'");
  await insert("now()-interval '1 day'", "now()");
  assert.equal(await active(), 0);
  await db.query("delete from memberships where id='v3boundary'");
  await insert("now()+interval '1 day'", "now()+interval '2 days'");
  assert.equal(await active(), 0);
  await db.query("delete from memberships where id='v3boundary'");
  await insert("now()", "now()+interval '1 day'");
  await db.query("update memberships set revoked_at=now() where id='v3boundary'");
  assert.equal(await active(), 0);
  await db.query("rollback");
  console.log(
    "PASS exact start inclusive / end exclusive / future / revoked policy boundaries under a transaction-frozen database clock",
  );
} finally {
  await db.end();
}
