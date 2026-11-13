import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

/** No unsandboxed mode. Probe before DB connection, heartbeat, or task claim. */
export function requireSandbox({ mode = "auto", workRoot, node, baseArgs }, run = spawnSync) {
  if (!["auto", "bwrap"].includes(mode.toLowerCase())) {
    throw new Error(`BUILD_SANDBOX=${mode} is forbidden: only auto/bwrap are supported; unsandboxed builds are disabled`);
  }
  const probe = mkdtempSync(join(workRoot, "bw-probe-"));
  try {
    // Verify no network and no inherited host environment; fail/timeout is not a pass.
    const script = `if(process.env.DATABASE_URL||process.env.BLUEOS_RPK_SIGN_DIR)process.exit(4);require('net').connect(443,'1.1.1.1').on('error',()=>process.exit(0)).on('connect',()=>process.exit(3))`;
    const result = run("bwrap", [...baseArgs(probe), "--clearenv", "--", node, "-e", script], { timeout: 15000, encoding: "utf8" });
    if (result.error || result.status !== 0 || result.signal) {
      throw new Error(`bwrap sandbox unavailable; refusing to start or claim tasks: ${result.error?.message || result.stderr || result.signal || result.status}`);
    }
    return "bwrap";
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
