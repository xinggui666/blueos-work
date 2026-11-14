#!/usr/bin/env node
/** Operator-only, selected-account bootstrap. Do not expose as HTTP endpoint. */
import pg from "pg";
import { randomBytes } from "node:crypto";
const args = process.argv.slice(2);
const get = (key) => args[args.indexOf(key) + 1];
const userId = args.includes("--user-id") ? get("--user-id") : "";
const email = args.includes("--email") ? get("--email").trim().toLowerCase() : "";
if (!process.env.DATABASE_URL || !userId || !email) {
  console.error(
    "Requires DATABASE_URL, --user-id and --email; restrict signup/network while provisioning.",
  );
  process.exit(2);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await db.connect();
  await db.query("begin");
  await db.query("select pg_advisory_xact_lock(41920301)");
  const user = (await db.query('select id,email from "user" where id=$1', [userId])).rows[0];
  if (!user || user.email.toLowerCase() !== email)
    throw new Error("selected account does not match");
  const supers = (await db.query("select user_id from user_roles where role='super_admin'")).rows;
  if (supers.length && !supers.some((r) => r.user_id === userId))
    throw new Error("another super administrator already exists");
  const profile = (await db.query("select status from profiles where user_id=$1", [userId]))
    .rows[0];
  if (profile?.status === "banned") throw new Error("selected account is banned");
  await db.query(
    "insert into profiles(user_id,display_name) values($1,'') on conflict do nothing",
    [userId],
  );
  const inserted = await db.query(
    "insert into user_roles(user_id,role) values($1,'super_admin') on conflict do nothing returning user_id",
    [userId],
  );
  if (inserted.rowCount)
    await db.query(
      "insert into audit_logs(id,actor_id,action,target,after) values($1,$2,'bootstrap.operator',$2,$3::jsonb)",
      [
        "boot" + randomBytes(8).toString("hex"),
        userId,
        JSON.stringify({ role: "super_admin", method: "operator-cli" }),
      ],
    );
  await db.query("commit");
  console.log("Selected-account bootstrap completed; no credentials printed.");
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error(
    "Bootstrap refused:",
    error.code || "selected account or existing administrator check failed",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
