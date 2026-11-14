#!/usr/bin/env node
/** Run every minute via an operator-owned scheduler. No credentials in CLI args/logs. */
import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be securely injected");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await db.connect();
  const r = await db.query("select activate_membership_credits() as activated");
  console.log("One-time membership segments activated:", r.rows[0].activated);
} finally {
  await db.end();
}
