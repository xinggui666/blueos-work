#!/usr/bin/env node
import assert from "node:assert/strict";
const BASE = process.env.API_BASE || "http://localhost:4019";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname))
  throw Error("local fixtures only");
const H = { "content-type": "application/json", origin: BASE },
  email = `auth-upgrade-${Date.now().toString(36)}@tests.invalid`,
  password = "V3-Auth-Upgrade-Fixture!";
let pass = 0;
async function step(name, fn) {
  await fn();
  pass++;
  console.log("PASS", name);
}
async function post(path, body, token) {
  return fetch(BASE + path, {
    method: "POST",
    headers: { ...H, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}
let token, second, id;
await step(
  "email signup and existing-account signin retain stable user and bearer session",
  async () => {
    let r = await post("/api/auth/sign-up/email", { email, password, name: "Auth fixture" });
    assert.equal(r.status, 200);
    id = (await r.json()).user.id;
    r = await post("/api/auth/sign-in/email", { email, password });
    assert.equal(r.status, 200);
    token = r.headers.get("set-auth-token");
    assert.ok(token);
    assert.equal((await r.json()).user.id, id);
  },
);
await step("wrong password and unauthenticated platform access are rejected", async () => {
  assert.equal(
    (await post("/api/auth/sign-in/email", { email, password: "incorrect-fixture" })).status,
    401,
  );
  assert.equal(
    (await post("/api/v1/platform", { action: "me", payload: {}, client: "android" })).status,
    401,
  );
});
await step("two sessions coexist; signout revokes only the selected bearer", async () => {
  const r = await post("/api/auth/sign-in/email", { email, password });
  second = r.headers.get("set-auth-token");
  assert.ok(second && second !== token);
  assert.equal((await post("/api/auth/sign-out", {}, token)).status, 200);
  assert.equal(
    (await post("/api/v1/platform", { action: "me", payload: {}, client: "android" }, token))
      .status,
    401,
  );
  const me = await post(
    "/api/v1/platform",
    { action: "me", payload: {}, client: "android" },
    second,
  );
  assert.equal(me.status, 200);
  assert.equal((await me.json()).userId, id);
});
await step(
  "new social API initiates broker OAuth with S256 and current callback path, without contacting provider",
  async () => {
    const r = await post("/api/auth/sign-in/social", {
      provider: "grok-google",
      callbackURL: BASE + "/",
      disableRedirect: true,
    });
    assert.equal(r.status, 200);
    const b = await r.json();
    const u = new URL(b.url);
    assert.ok(u.searchParams.get("state"));
    assert.ok(u.searchParams.get("code_challenge"));
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      new URL(u.searchParams.get("redirect_uri")).pathname,
      "/api/auth/callback/grok-google",
    );
  },
);
await step(
  "popup uses migrated server social endpoint and returns authorization redirect",
  async () => {
    const r = await fetch(BASE + "/auth/popup?providerId=grok-google", { redirect: "manual" });
    assert.ok([302, 303, 307].includes(r.status));
    const u = new URL(r.headers.get("location"));
    assert.ok(u.searchParams.get("state"));
    assert.equal(
      new URL(u.searchParams.get("redirect_uri")).pathname,
      "/api/auth/callback/grok-google",
    );
  },
);
await step(
  "unknown provider and forged callback state do not create a signed-in session",
  async () => {
    assert.equal(
      (
        await post("/api/auth/sign-in/social", {
          provider: "unconfigured-fixture",
          callbackURL: BASE + "/",
          disableRedirect: true,
        })
      ).status,
      404,
    );
    const r = await fetch(
      BASE + "/api/auth/callback/grok-google?code=fixture&state=invalid-fixture",
      { redirect: "manual" },
    );
    assert.ok([302, 303, 400, 401].includes(r.status));
    assert.equal(r.headers.has("set-auth-token"), false);
    const session = await fetch(BASE + "/api/auth/get-session");
    assert.equal(await session.json(), null);
  },
);
console.log(
  `${pass} actual local HTTP auth compatibility cases passed; provider callback/login to real broker remains untested`,
);
