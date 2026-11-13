#!/usr/bin/env node
/**
 * 蓝河工坊 RPK 构建 Worker（规格第十三章）。和 API 服务分开运行，只通过数据库领取任务。
 *
 *   DATABASE_URL=postgres://...            必填
 *   BLUEOS_TOOLKIT_DIR=/opt/blueos-toolkit 必填：已安装官方 blueos-toolkit（node_modules/.bin/bot）的目录，见 worker/install-toolkit.sh
 *   BLUEOS_RPK_SIGN_DIR=/secrets/rpk-sign  可选：含 private.pem + certificate.pem 时出 release 包，否则出 debug 包
 *   BUILD_SANDBOX=auto|bwrap|none          默认 auto：bwrap 可用就用（无网络、只读系统目录），不可用时退回 none 并在任务里如实记录
 *   BUILD_TIMEOUT_SEC=300  BUILD_MEMORY_MB=1536  BUILD_WORK_DIR=系统临时目录  WORKER_ID=主机名+进程号
 *   node worker/build-worker.mjs [--once]   --once：处理完当前队列就退出（测试用）
 *
 * 安全：不执行用户脚本（工程只是数据，生成器输出固定模板 + 解释器）；编译进程环境变量清空，
 * 不带数据库地址和任何密钥（release 签名证书只在编译期间复制进临时目录，结束即删除）；
 * 限制 CPU 时间、单文件大小、内存和总时长；产物做结构和完整性检查后才算成功。
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pg from "pg";
import { readZipEntries, verifyRpk } from "./rpk.mjs";

const env = process.env;
const once = process.argv.includes("--once");
const DATABASE_URL = env.DATABASE_URL;
const TOOLKIT_DIR = env.BLUEOS_TOOLKIT_DIR;
const SIGN_DIR = env.BLUEOS_RPK_SIGN_DIR || "";
const TIMEOUT_SEC = Number(env.BUILD_TIMEOUT_SEC || 300);
const MEMORY_MB = Number(env.BUILD_MEMORY_MB || 1536);
const WORK_ROOT = env.BUILD_WORK_DIR || tmpdir();
const WORKER_ID = env.WORKER_ID || `${hostname()}-${process.pid}`;
const POLL_MS = Number(env.BUILD_POLL_MS || 2000);
const STALE_SECONDS = 180;
const LOG_LIMIT = 60_000;

function fatal(message) {
  console.error(`[worker] ${message}`);
  process.exit(1);
}
if (!DATABASE_URL) fatal("缺少 DATABASE_URL");
if (!TOOLKIT_DIR) fatal("缺少 BLUEOS_TOOLKIT_DIR（官方 blueos-toolkit 安装目录）");
const BOT = join(TOOLKIT_DIR, "node_modules", "blueos-toolkit", "bin", "index.js");
if (!existsSync(BOT)) fatal(`在 ${TOOLKIT_DIR} 找不到 blueos-toolkit，请先运行 worker/install-toolkit.sh`);
const TOOLKIT_VERSION = `blueos-toolkit ${JSON.parse(readFileSync(join(TOOLKIT_DIR, "node_modules", "blueos-toolkit", "package.json"), "utf8")).version}`;
const SIGNING = Boolean(SIGN_DIR && existsSync(join(SIGN_DIR, "private.pem")) && existsSync(join(SIGN_DIR, "certificate.pem")));
const NODE = process.execPath;

/* ---------------- 沙箱 ---------------- */

function bwrapBase(work) {
  const args = ["--unshare-all", "--die-with-parent", "--new-session", "--ro-bind", "/usr", "/usr"];
  for (const d of ["/bin", "/lib", "/lib64", "/sbin"]) {
    if (!existsSync(d)) continue;
    const st = lstatSync(d);
    if (st.isSymbolicLink()) args.push("--symlink", readlinkSync(d), d);
    else if (st.isDirectory()) args.push("--ro-bind", d, d);
  }
  if (!NODE.startsWith("/usr/")) args.push("--ro-bind", dirname(dirname(NODE)), dirname(dirname(NODE)));
  // 工具链目录以覆盖层挂载：工具链运行时会 chmod 自带的 aapt，写入只落在临时层，宿主机上的工具链不会被改动。
  args.push("--overlay-src", TOOLKIT_DIR, "--tmp-overlay", "/toolkit", "--bind", work, "/work", "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev");
  return args;
}

function detectSandbox() {
  const want = (env.BUILD_SANDBOX || "auto").toLowerCase();
  if (want === "none") return "none";
  const probe = mkdtempSync(join(WORK_ROOT, "bw-probe-"));
  const r = spawnSync("bwrap", [...bwrapBase(probe), "--", NODE, "-e", "require('net').connect(443,'1.1.1.1').on('error',()=>process.exit(0)).on('connect',()=>process.exit(3))"], { timeout: 15000 });
  rmSync(probe, { recursive: true, force: true });
  if (r.status === 0) return "bwrap";
  if (want === "bwrap") fatal(`要求使用 bwrap 沙箱，但不可用：${r.error?.message ?? r.stderr?.toString().slice(0, 300) ?? r.status}`);
  console.warn("[worker] bwrap 不可用，编译进程不做命名空间隔离（仍有资源限制）。生产环境请用 Docker 内部网络或启用 bwrap。");
  return "none";
}
const SANDBOX = detectSandbox();

/** 在沙箱里运行 bot <command>，返回 { code, log, timedOut, killed }。 */
function runBot(work, command, onSpawn) {
  const inner = SANDBOX === "bwrap" ? { app: "/work/app", home: "/work/home", bot: "/toolkit/node_modules/blueos-toolkit/bin/index.js" } : { app: join(work, "app"), home: join(work, "home"), bot: BOT };
  const childEnv = { HOME: inner.home, PATH: "/usr/local/bin:/usr/bin:/bin", NODE_OPTIONS: `--max-old-space-size=${MEMORY_MB}`, LANG: "C.UTF-8", CI: "1" };
  const limited = ["prlimit", `--cpu=${TIMEOUT_SEC * 2}`, `--fsize=${200 * 1024 * 1024}`, "--nofile=4096", "--", NODE, inner.bot, command];
  let cmd;
  let args;
  if (SANDBOX === "bwrap") {
    cmd = "bwrap";
    args = [...bwrapBase(work), "--chdir", inner.app, "--clearenv", ...Object.entries(childEnv).flatMap(([k, v]) => ["--setenv", k, v]), "--", ...limited];
  } else {
    cmd = limited[0];
    args = limited.slice(1);
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: join(work, "app"), env: SANDBOX === "bwrap" ? {} : childEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let log = "";
    const add = (chunk) => {
      log += chunk.toString();
      if (log.length > LOG_LIMIT * 2) log = log.slice(-LOG_LIMIT);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    let timedOut = false;
    let killed = false;
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // 已退出
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, TIMEOUT_SEC * 1000);
    onSpawn?.(() => {
      killed = true;
      kill();
    });
    child.on("error", (error) => add(`\n启动失败：${error.message}\n`));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, log, timedOut, killed });
    });
  });
}

/* ---------------- 数据库 ---------------- */

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
const qid = () => "q" + randomBytes(8).toString("hex");

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function heartbeat() {
  await pool.query(
    `insert into build_workers (id, host, toolkit, sandbox, signing, seen_at) values ($1,$2,$3,$4,$5, now())
     on conflict (id) do update set toolkit = excluded.toolkit, sandbox = excluded.sandbox, signing = excluded.signing, seen_at = now()`,
    [WORKER_ID, hostname(), TOOLKIT_VERSION, SANDBOX, SIGNING],
  );
}

/** 终态 + 释放预扣（只有把状态从 from 改掉的那次释放，重复执行无副作用）。 */
async function finishRelease(taskId, from, to, error, extra = {}) {
  return tx(async (c) => {
    const r = await c.query(
      `update build_tasks set status = $2, error = $3, finished_at = now(), log = coalesce($5, log), verify = coalesce($6, verify),
         quota_state = case when quota_state = 'reserved' then 'released' else quota_state end
       where id = $1 and status = any($4::text[]) returning user_id, quota_state`,
      [taskId, to, error, from, extra.log ?? null, extra.verify ? JSON.stringify(extra.verify) : null],
    );
    if (!r.rows.length) return false;
    if (r.rows[0].quota_state === "released") {
      const u = await c.query("update quota_accounts set reserved = reserved - 1 where user_id = $1 and kind = 'build' and reserved >= 1 returning reserved", [r.rows[0].user_id]);
      if (u.rows.length)
        await c.query("insert into quota_ledger (id, user_id, kind, delta, phase, ref, note) values ($1,$2,'build',-1,'release',$3,$4)", [
          qid(),
          r.rows[0].user_id,
          taskId,
          to === "cancelled" ? "构建取消，释放预扣" : "构建失败，释放预扣",
        ]);
    }
    return true;
  });
}

/** 成功：保存产物并确认扣分，同一事务。确认失败（积分被后台扣走）时整体回滚，改判失败并释放。 */
async function finishSuccess(task, rpk, name, verify, log) {
  try {
    return await tx(async (c) => {
      // 锁住任务行读积分状态：reserved 要确认扣分；waived（管理员重试）不扣分。
      const cur = await c.query("select quota_state from build_tasks where id = $1 and status = 'running' and worker_id = $2 and cancel_requested = false for update", [task.id, WORKER_ID]);
      const was = cur.rows[0]?.quota_state;
      if (was !== "reserved" && was !== "waived") return false;
      const r = await c.query(
        `update build_tasks set status = 'succeeded', quota_state = $9, artifact = $3, artifact_name = $4, artifact_sha256 = $5, artifact_bytes = $6,
           verify = $7, log = $8, error = '', finished_at = now()
         where id = $1 and status = 'running' and worker_id = $2 returning user_id`,
        [task.id, WORKER_ID, rpk, name, verify.sha256, rpk.length, JSON.stringify(verify), log, was === "reserved" ? "committed" : "waived"],
      );
      if (!r.rows.length) return false;
      if (was === "waived") return true;
      const u = await c.query(
        "update quota_accounts set balance = balance - 1, reserved = reserved - 1 where user_id = $1 and kind = 'build' and reserved >= 1 and balance >= 1 returning balance",
        [task.user_id],
      );
      if (!u.rows.length) throw new Error("确认扣分失败：打包积分余额不足");
      await c.query("insert into quota_ledger (id, user_id, kind, delta, phase, ref, note) values ($1,$2,'build',-1,'commit',$3,'RPK 构建成功，确认消耗 1')", [qid(), task.user_id, task.id]);
      return true;
    });
  } catch (error) {
    await finishRelease(task.id, ["running"], "failed", error.message, { log });
    return false;
  }
}

async function sweepStale() {
  const r = await pool.query(`select id from build_tasks where status = 'running' and coalesce(heartbeat_at, started_at) < now() - ($1 || ' seconds')::interval`, [String(STALE_SECONDS)]);
  for (const row of r.rows) await finishRelease(row.id, ["running"], "failed", "构建 Worker 失联，任务已判失败，预扣积分已释放");
}

/** 待排队 → 等待执行：该用户正在等待/执行的任务数低于套餐并发数时放行。 */
async function promote() {
  await pool.query(`
    update build_tasks t set status = 'waiting'
    where t.status = 'queued' and t.id = (
      select q.id from build_tasks q where q.user_id = t.user_id and q.status = 'queued' order by q.created_at limit 1
    ) and (
      select count(*) from build_tasks a where a.user_id = t.user_id and a.status in ('waiting','running')
    ) < greatest(1, coalesce((
      select max(p.concurrency) from memberships m join plans p on p.id = m.plan_id where m.user_id = t.user_id and m.ends_at > now()
    ), 1))`);
}

async function claim() {
  const environment = { sandbox: SANDBOX, node: process.version, timeoutSec: TIMEOUT_SEC, memoryMb: MEMORY_MB, signing: SIGNING, host: hostname() };
  const r = await pool.query(
    `with c as (select id from build_tasks where status = 'waiting' order by priority desc, created_at for update skip locked limit 1)
     update build_tasks t set status = 'running', worker_id = $1, started_at = now(), heartbeat_at = now(), toolkit = $2, environment = $3
     from c where t.id = c.id returning t.id, t.user_id, t.mode, t.package_name, t.version_name, t.version_code, t.routes, t.source_zip`,
    [WORKER_ID, TOOLKIT_VERSION, JSON.stringify(environment)],
  );
  return r.rows[0] ?? null;
}

/* ---------------- 执行一个任务 ---------------- */

function findRpk(dir, mode) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".rpk")) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.find((p) => p.includes(`/${mode}/`) || p.includes(`.${mode}.`)) ?? null;
}

function cleanLog(log, work) {
  // 去掉终端颜色码（ESC [ ... m）。
  const ansi = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
  return log.split(work).join("<work>").replace(ansi, "").slice(-LOG_LIMIT);
}

async function runTask(task) {
  const work = mkdtempSync(join(WORK_ROOT, "bw-build-"));
  let log = `任务 ${task.id}｜${TOOLKIT_VERSION}｜沙箱 ${SANDBOX}｜${task.mode}\n`;
  let cancel = null;
  const beat = setInterval(async () => {
    try {
      const r = await pool.query("update build_tasks set heartbeat_at = now() where id = $1 and worker_id = $2 returning cancel_requested", [task.id, WORKER_ID]);
      if (r.rows[0]?.cancel_requested && cancel) cancel();
    } catch (error) {
      console.error("[worker] 心跳失败", error.message);
    }
  }, 10_000);
  try {
    mkdirSync(join(work, "app"), { recursive: true });
    mkdirSync(join(work, "home"), { recursive: true });
    // 解压源工程（只允许相对路径）。
    for (const entry of readZipEntries(Buffer.from(task.source_zip))) {
      if (entry.name.endsWith("/")) continue;
      const path = join(work, "app", entry.name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, entry.data());
    }
    if (task.mode === "release") {
      if (!SIGNING) throw new Error("这个 Worker 没有配置 release 签名证书");
      mkdirSync(join(work, "app", "sign"), { recursive: true });
      copyFileSync(join(SIGN_DIR, "private.pem"), join(work, "app", "sign", "private.pem"));
      copyFileSync(join(SIGN_DIR, "certificate.pem"), join(work, "app", "sign", "certificate.pem"));
    }
    const started = Date.now();
    // 与官方流程一致：先 bot build；release 包再执行 bot release（需要 sign/ 下的证书）。
    let result = await runBot(work, "build", (k) => (cancel = k));
    if (task.mode === "release" && result.code === 0 && !result.killed && !result.timedOut) {
      const first = result.log;
      result = await runBot(work, "release", (k) => (cancel = k));
      result.log = first + result.log;
    }
    rmSync(join(work, "app", "sign"), { recursive: true, force: true });
    log += cleanLog(result.log, work) + `\n退出码 ${result.code}，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒\n`;
    if (result.killed) return await finishRelease(task.id, ["running"], "cancelled", "用户取消，编译已停止", { log });
    if (result.timedOut) return await finishRelease(task.id, ["running"], "failed", `编译超时（${TIMEOUT_SEC} 秒）`, { log });
    if (result.code !== 0) return await finishRelease(task.id, ["running"], "failed", `官方工具链编译失败（退出码 ${result.code}），详见日志`, { log });
    const file = findRpk(join(work, "app", "dist"), task.mode);
    if (!file) return await finishRelease(task.id, ["running"], "failed", "编译结束但没有找到 RPK 文件", { log });
    const rpk = readFileSync(file);
    const verify = verifyRpk(rpk, {
      packageName: task.package_name,
      versionName: task.version_name,
      versionCode: task.version_code,
      mode: task.mode,
      routes: task.routes,
    });
    log += `产物 ${file.split("/").pop()}，${rpk.length} 字节，SHA-256 ${verify.sha256}\n` + verify.checks.map((c) => `${c.ok ? "✔" : "✖"} ${c.name} ${c.detail}`).join("\n") + "\n";
    if (!verify.ok) return await finishRelease(task.id, ["running"], "failed", "产物检查未通过，没有当作成功", { log, verify });
    const cancelled = (await pool.query("select cancel_requested from build_tasks where id = $1", [task.id])).rows[0]?.cancel_requested;
    if (cancelled) return await finishRelease(task.id, ["running"], "cancelled", "用户取消", { log });
    return await finishSuccess(task, rpk, file.split("/").pop(), verify, log);
  } catch (error) {
    return await finishRelease(task.id, ["running"], "failed", `构建出错：${error.message}`, { log: log + `\n${error.message}\n` });
  } finally {
    clearInterval(beat);
    rmSync(work, { recursive: true, force: true });
  }
}

/* ---------------- 主循环 ---------------- */

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

console.log(`[worker] ${WORKER_ID} 启动：${TOOLKIT_VERSION}，沙箱 ${SANDBOX}，${SIGNING ? "release 签名已配置" : "无签名证书，只出 debug 包"}`);
while (!stopping) {
  try {
    await heartbeat();
    await sweepStale();
    await promote();
    const task = await claim();
    if (task) {
      console.log(`[worker] 开始 ${task.id}`);
      await runTask(task);
      const row = (await pool.query("select status, error from build_tasks where id = $1", [task.id])).rows[0];
      console.log(`[worker] 结束 ${task.id}：${row?.status} ${row?.error ?? ""}`);
      continue;
    }
    if (once) break;
  } catch (error) {
    console.error("[worker] 循环出错", error.message);
    if (once) process.exitCode = 1;
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
await pool.query("delete from build_workers where id = $1", [WORKER_ID]).catch(() => {});
await pool.end();
