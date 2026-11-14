#!/usr/bin/env node
/** Real worker+PostgreSQL+bwrap; compiler is a declared 70s failure fixture, NOT an RPK compilation proof. */
import assert from "node:assert/strict";
import pg from "pg";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const url = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.startsWith("/blueos_v3_"))
  throw Error("disposable local database required");
const BASE = process.env.API_BASE || "http://localhost:4012",
  H = { "content-type": "application/json", origin: BASE },
  db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const tag = Date.now().toString(36),
  workerId = "v3-long-" + tag,
  dir = await mkdtemp(join(tmpdir(), "blueos-v3-slow-toolkit-"));
let worker;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function auth(email, signup = false) {
  const password = "V3-Disposable-Only-4011!";
  if (signup)
    await fetch(BASE + "/api/auth/sign-up/email", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ email, password, name: "heartbeat test" }),
    });
  const r = await fetch(BASE + "/api/auth/sign-in/email", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password }),
  });
  const token = r.headers.get("set-auth-token");
  assert.ok(token);
  return token;
}
async function call(token, action, payload = {}) {
  const r = await fetch(BASE + "/api/v1/platform", {
    method: "POST",
    headers: { ...H, authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, payload, client: "web" }),
  });
  const value = await r.json();
  assert.equal(r.status, 200, JSON.stringify(value));
  return value;
}
try {
  const admin = await auth("v3-admin@tests.invalid"),
    token = await auth(`heartbeat-${tag}@tests.invalid`, true),
    me = await call(token, "me");
  await call(admin, "adminSetConfig", { key: "build_enabled", value: true });
  await call(admin, "adminGrantQuota", {
    userId: me.userId,
    kind: "build",
    delta: 3,
    note: "synthetic compiler heartbeat regression",
  });
  await mkdir(join(dir, "node_modules/blueos-toolkit/bin"), { recursive: true });
  await writeFile(
    join(dir, "node_modules/blueos-toolkit/package.json"),
    JSON.stringify({ version: "v3-heartbeat-fixture" }),
  );
  await writeFile(
    join(dir, "node_modules/blueos-toolkit/bin/index.js"),
    "setTimeout(() => process.exit(1),70000);\n",
  );
  worker = spawn(process.execPath, ["worker/build-worker.mjs"], {
    env: {
      ...process.env,
      WORKER_ID: workerId,
      BLUEOS_TOOLKIT_DIR: dir,
      BUILD_TIMEOUT_SEC: "90",
      BUILD_POLL_MS: "100",
      BLUEOS_RPK_SIGN_DIR: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  worker.stdout.on("data", (d) => (output += d));
  worker.stderr.on("data", (d) => (output += d));
  for (let i = 0; i < 60; i++) {
    if ((await db.query("select id from build_workers where id=$1", [workerId])).rowCount) break;
    if (worker.exitCode !== null) throw Error(output);
    await sleep(200);
  }
  const project = {
    id: "v3heartbeat" + tag,
    name: "heartbeat",
    appName: "heartbeat",
    packageName: "com.v3.heartbeat",
    device: "watch-round",
    pages: [{ id: "page1", name: "Home", nodes: [] }],
    revisions: [],
  };
  const saved = await call(token, "syncProject", { project });
  const task = await call(token, "requestBuild", {
    projectId: project.id,
    expectedRevision: saved.revision,
  });
  for (let i = 0; i < 40; i++) {
    if ((await call(token, "getBuild", { id: task.id })).status === "running") break;
    await sleep(200);
  }
  const started = Date.now();
  while (Date.now() - started < 65000) {
    if (worker.exitCode !== null) throw Error(output);
    await sleep(1000);
  }
  const live = (
    await db.query(
      "select seen_at > now()-interval '25 seconds' as live from build_workers where id=$1",
      [workerId],
    )
  ).rows[0];
  assert.equal(live?.live, true);
  assert.equal((await call(token, "getBuild", { id: task.id })).status, "running");
  console.log(
    "PASS actual worker heartbeat remains live beyond 60s during a 70s fixture compiler command",
  );
  project.name = "heartbeat-next";
  const next = await call(token, "syncProject", {
    project: {
      ...project,
      protocolExtras: (await call(token, "listProjects")).find((p) => p.id === project.id)
        .protocolExtras,
    },
  });
  const queued = await call(token, "requestBuild", {
    projectId: project.id,
    expectedRevision: next.revision,
  });
  assert.notEqual(queued.status, "unavailable");
  await call(token, "cancelBuild", { id: queued.id });
  console.log(
    "PASS new request while long compile running is not falsely unavailable; queued reservation cancelled",
  );
  for (let i = 0; i < 25; i++) {
    const end = await call(token, "getBuild", { id: task.id });
    if (end.status === "failed") {
      assert.equal(end.quotaState, "released");
      break;
    }
    await sleep(1000);
  }
  const end = await call(token, "getBuild", { id: task.id });
  assert.equal(end.status, "failed");
  assert.deepEqual((await call(token, "me")).quota.build, { balance: 3, reserved: 0 });
  console.log(
    "PASS fixture compiler failure releases reservation exactly once; no RPK success claimed",
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (worker && worker.exitCode === null) {
    const done = new Promise((r) => worker.once("exit", r));
    worker.kill("SIGTERM");
    await done;
  }
  await call(await auth("v3-admin@tests.invalid"), "adminSetConfig", {
    key: "build_enabled",
    value: false,
  }).catch(() => {});
  await db.end();
  await rm(dir, { recursive: true, force: true });
}
