#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";
import { spawnSync } from "node:child_process";
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.startsWith("/blueos_v3_"))
  throw Error("disposable V3 database only");
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  assert.equal(
    (await db.query("select count(*)::int as n from _migrations where name like '0009%'")).rows[0]
      .n,
    0,
    "requires a populated 0008 test database",
  );
  const read = async () => ({
    members: (
      await db.query("select id,snapshot,starts_at,ends_at,revoked_at from memberships order by id")
    ).rows,
    orders: (await db.query("select id,snapshot,status from orders order by id")).rows,
    balances: (await db.query("select * from quota_accounts order by user_id,kind")).rows,
    ledger: (await db.query("select * from quota_ledger order by id")).rows,
  });
  const before = await read();
  assert.ok(
    before.members.length > 0 && before.ledger.length > 0,
    "requires actual old membership and quota data",
  );
  const run = () =>
    spawnSync(process.execPath, ["scripts/migrate.mjs"], { env: process.env, encoding: "utf8" });
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  console.log(r.stdout.trim());
  assert.deepEqual(await read(), before);
  console.log(
    "PASS nonempty 0008->0009 preserves all prior memberships/order snapshots, every balance and every ledger row",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from memberships where credits_state<>'applied' or credits_applied_at is not null",
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await db.query("select activate_membership_credits() as n")).rows[0].n, 0);
  assert.deepEqual(await read(), before);
  console.log(
    "PASS legacy eager credits are not silently regranted or clawed back, including future segments",
  );
  r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /up to date/);
  console.log("PASS repeated migration is idempotent");
} finally {
  await db.end();
}
