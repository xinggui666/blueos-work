import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { requireSandbox } from "./sandbox.mjs";
const options = { workRoot: tmpdir(), node: process.execPath, baseArgs: (p) => [p] };
test("auto and bwrap fail closed on missing binary, denial, timeout, network leak", () => {
  for (const mode of ["auto", "bwrap"]) {
    for (const result of [{ error: new Error("ENOENT"), status: null }, { status: 1, stderr: "Operation not permitted" }, { status: null, signal: "SIGTERM" }, { status: 3 }]) {
      let directory;
      assert.throws(() => requireSandbox({ ...options, mode }, (_cmd, args) => { directory = args[0]; return result; }), /refusing/);
      assert.equal(existsSync(directory), false);
    }
  }
});
test("none and unknown modes cannot invoke compiler", () => {
  for (const mode of ["none", "docker", "anything"]) assert.throws(() => requireSandbox({ ...options, mode }, () => assert.fail("must not spawn")), /forbidden/);
});
test("successful isolated probe requires clear environment and returns bwrap", () => {
  assert.equal(requireSandbox(options, (cmd, args) => {
    assert.equal(cmd, "bwrap");
    assert.ok(args.includes("--clearenv"));
    return { status: 0 };
  }), "bwrap");
});

test("worker process exits before database heartbeat/claim if sandbox absent or forbidden", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const root = mkdtempSync(join(tmpdir(), "bw-sandbox-test-"));
  try {
    // Toolkit metadata fixture; the executable must never run.
    const toolkit = join(root, "node_modules/blueos-toolkit");
    mkdirSync(join(toolkit, "bin"), { recursive: true });
    writeFileSync(join(toolkit, "package.json"), JSON.stringify({ version: "test-fixture" }));
    writeFileSync(join(toolkit, "bin/index.js"), "throw new Error('must never execute')");
    for (const mode of ["auto", "bwrap", "none"]) {
      const result = spawnSync(process.execPath, ["worker/build-worker.mjs", "--once"], {
        env: { PATH: root, DATABASE_URL: "postgres://invalid.invalid/test", BLUEOS_TOOLKIT_DIR: root, BUILD_SANDBOX: mode },
        encoding: "utf8", timeout: 20000,
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, mode === "none" ? /forbidden/ : /refusing to start or claim/);
      assert.doesNotMatch(result.stdout + result.stderr, /循环出错|ENOTFOUND|启动：|开始 /);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
