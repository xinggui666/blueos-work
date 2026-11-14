#!/usr/bin/env node
/** Disposable fixture only. Privilege comes from explicit operator CLI, never public registration. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
const db = new URL(process.env.DATABASE_URL || ""),
  base = process.env.API_BASE || "",
  origin = process.env.API_ORIGIN || base;
assert.equal(
  process.env.BLUEOS_ALLOW_TEST_BOOTSTRAP,
  "1",
  "explicit fixture bootstrap opt-in required",
);
assert.ok(
  ["localhost", "127.0.0.1"].includes(db.hostname) && /^\/blueos_ci(?:_|$)/.test(db.pathname),
  "dedicated localhost blueos_ci fixture database required",
);
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "localhost HTTP fixture required",
);
const email = `ci-admin-${Date.now().toString(36)}@tests.invalid`,
  password = randomBytes(24).toString("hex"),
  headers = { "content-type": "application/json", origin };
const up = await fetch(base + "/api/auth/sign-up/email", {
  method: "POST",
  headers,
  body: JSON.stringify({ email, password, name: "Selected CI fixture" }),
});
assert.equal(up.status, 200);
const user = (await up.json()).user;
assert.ok(user?.id);
const sign = await fetch(base + "/api/auth/sign-in/email", {
  method: "POST",
  headers,
  body: JSON.stringify({ email, password }),
});
assert.equal(sign.status, 200);
const token = sign.headers.get("set-auth-token");
assert.ok(token);
const me = await fetch(base + "/api/v1/platform", {
  method: "POST",
  headers: { ...headers, authorization: "Bearer " + token },
  body: JSON.stringify({ action: "me", payload: {}, client: "android" }),
});
assert.equal(me.status, 200);
assert.deepEqual((await me.json()).roles, []);
console.log("PASS new public CI account is not privileged before explicit operator bootstrap");
const boot = spawnSync(
  process.execPath,
  ["scripts/bootstrap-admin.mjs", "--user-id", user.id, "--email", email],
  { env: process.env, stdio: "inherit" },
);
assert.equal(boot.status, 0);
const smoke = spawnSync(process.execPath, ["scripts/api-smoke.mjs"], {
  env: { ...process.env, SMOKE_ADMIN_EMAIL: email, SMOKE_ADMIN_PASSWORD: password },
  stdio: "inherit",
});
process.exitCode = smoke.status ?? 1;
