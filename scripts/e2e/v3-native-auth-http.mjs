#!/usr/bin/env node
/** Actual HTTP, no Origin/Sec-Fetch headers for native requests; no external OAuth login. */
import assert from "node:assert/strict";
import { request as http } from "node:http";
import { randomBytes } from "node:crypto";
const BASE = process.env.API_BASE || "http://localhost:4020";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname))
  throw Error("local disposable auth fixture only");
const password = randomBytes(24).toString("hex"),
  tag = Date.now().toString(36);
let pass = 0;
async function req(path, method = "GET", body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = http(
      new URL(path, BASE),
      {
        method,
        headers: {
          ...(data
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => {
          let value;
          try {
            value = JSON.parse(text);
          } catch {
            value = text;
          }
          resolve({ status: res.statusCode, body: value, headers: res.headers });
        });
      },
    );
    r.setTimeout(15000, () => r.destroy(Error("fixture timeout")));
    r.on("error", reject);
    r.end(data);
  });
}
async function step(name, fn) {
  await fn();
  console.log("PASS", name);
  pass++;
}
async function signup(email) {
  const r = await req("/api/auth/sign-up/email", "POST", {
    email,
    password,
    name: "Native HTTP fixture",
  });
  assert.equal(r.status, 200);
  return r.body.user.id;
}
async function signin(email) {
  const r = await req("/api/auth/sign-in/email", "POST", { email, password });
  assert.equal(r.status, 200);
  assert.ok(r.headers["set-auth-token"]);
  return {
    token: r.headers["set-auth-token"],
    cookie: (r.headers["set-cookie"] || []).map((x) => x.split(";")[0]).join("; "),
  };
}
const aEmail = `native-http-a-${tag}@tests.invalid`,
  bEmail = `native-http-b-${tag}@tests.invalid`;
let aId, bId, a, b, a2;
await step(
  "native signup/signin/get-session paths accept no-Origin HTTP and return stable user identity",
  async () => {
    aId = await signup(aEmail);
    a = await signin(aEmail);
    const s = await req("/api/auth/get-session", "GET", undefined, {
      authorization: "Bearer " + a.token,
    });
    assert.equal(s.status, 200);
    assert.equal(s.body.user.id, aId);
  },
);
await step(
  "browser cookie get-session remains compatible after Better Auth1.7 upgrade",
  async () => {
    const s = await req("/api/auth/get-session", "GET", undefined, { cookie: a.cookie });
    assert.equal(s.status, 200);
    assert.equal(s.body.user.id, aId);
  },
);
await step(
  "second account bearer cannot impersonate first account even with expected-user payload",
  async () => {
    bId = await signup(bEmail);
    b = await signin(bEmail);
    const me = await req(
      "/api/v1/platform",
      "POST",
      { action: "me", payload: {}, client: "android" },
      { authorization: "Bearer " + b.token },
    );
    assert.equal(me.status, 200);
    assert.equal(me.body.userId, bId);
    const denied = await req(
      "/api/v1/platform",
      "POST",
      { action: "me", payload: { expectedUserId: aId }, client: "android" },
      { authorization: "Bearer " + b.token },
    );
    assert.equal(denied.status, 409);
  },
);
await step(
  "cross-origin cookie signout is rejected without revoking legitimate session",
  async () => {
    const r = await req(
      "/api/auth/sign-out",
      "POST",
      {},
      { cookie: a.cookie, origin: "https://untrusted.invalid" },
    );
    assert.equal(r.status, 403);
    assert.equal(
      (await req("/api/auth/get-session", "GET", undefined, { authorization: "Bearer " + a.token }))
        .body.user.id,
      aId,
    );
  },
);
await step(
  "native bearer signout revokes only selected session, other same-account/device and other account remain",
  async () => {
    a2 = await signin(aEmail);
    assert.equal(
      (await req("/api/auth/sign-out", "POST", {}, { authorization: "Bearer " + a.token })).status,
      200,
    );
    assert.equal(
      (await req("/api/auth/get-session", "GET", undefined, { authorization: "Bearer " + a.token }))
        .body,
      null,
    );
    assert.equal(
      (
        await req("/api/auth/get-session", "GET", undefined, {
          authorization: "Bearer " + a2.token,
        })
      ).body.user.id,
      aId,
    );
    assert.equal(
      (await req("/api/auth/get-session", "GET", undefined, { authorization: "Bearer " + b.token }))
        .body.user.id,
      bId,
    );
  },
);
await step(
  "invalid bearer cannot obtain session or platform access; no fabricated alternate session path used",
  async () => {
    const s = await req("/api/auth/get-session", "GET", undefined, {
      authorization: "Bearer invalid-fixture",
    });
    assert.equal(s.status, 200);
    assert.equal(s.body, null);
    assert.equal(
      (
        await req(
          "/api/v1/platform",
          "POST",
          { action: "me", payload: {}, client: "android" },
          { authorization: "Bearer invalid-fixture" },
        )
      ).status,
      401,
    );
  },
);
console.log(
  JSON.stringify({
    pass,
    environment:
      "actual local HTTP + PostgreSQL + Better Auth1.7, native-shaped and browser-cookie requests",
    externalOAuth: false,
    javaHttpRuntime: false,
  }),
);
