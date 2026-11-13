/**
 * RPK 构建任务（规格第十三章、12.4）。
 *
 * API 这一侧只做：检查账号/开关/在线 Worker → 固定工程修订和组件版本 → 校验并生成源工程 →
 * 预扣 1 个 RPK 打包积分 → 创建任务。真正的编译在独立进程 worker/build-worker.mjs 里，
 * 成功后由 Worker 确认扣分，失败、取消、Worker 失联时释放预扣。
 *
 * 不可用（没开构建或没有在线 Worker）只记录任务，不预扣，也不会显示成功。
 */
import { randomBytes } from "node:crypto";
import { withTransaction, type Sql } from "@/lib/db";
import { generateNative } from "@/lib/generator/native";
import { ApiError, notFound } from "./errors";
import { loadOwnedDoc } from "./projects.server";
import { ensureQuota, release, reserve } from "./quota.server";

type Row = Record<string, unknown>;

export const BUILD_ACTIONS = ["requestBuild", "listBuilds", "getBuild", "cancelBuild", "downloadBuild"] as const;
export type BuildAction = (typeof BUILD_ACTIONS)[number];
export const isBuildAction = (a: string): a is BuildAction => (BUILD_ACTIONS as readonly string[]).includes(a);

export const BUILD_STATUS_LABEL: Record<string, string> = {
  queued: "待排队",
  waiting: "等待执行",
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  unavailable: "不可用",
};

/** Worker 心跳超过这个时间视为离线；执行中的任务心跳超过 STALE 视为失联。 */
export const WORKER_ONLINE_SECONDS = 60;
export const STALE_SECONDS = 180;

export type BuildDeps = {
  flags: Record<string, string>;
  /** 组件类型 → 不可用原因（空串表示可用，undefined 表示未上架）。 */
  palette: () => Promise<Record<string, string>>;
  concurrency: () => Promise<number>;
  priority: () => Promise<number>;
};

const newId = () => "bld" + randomBytes(8).toString("hex");
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const text = (v: unknown, max = 64) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bytesOf = (v: unknown): Uint8Array | null => (v instanceof Uint8Array ? v : null);

export function buildCard(row: Row) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    revision: Number(row.revision),
    status: String(row.status),
    statusLabel: BUILD_STATUS_LABEL[String(row.status)] ?? String(row.status),
    mode: String(row.mode),
    packageName: String(row.package_name),
    versionName: String(row.version_name),
    versionCode: Number(row.version_code),
    generator: String(row.generator),
    toolkit: String(row.toolkit ?? ""),
    quotaState: String(row.quota_state),
    cancelRequested: Boolean(row.cancel_requested),
    error: String(row.error ?? ""),
    artifactName: row.artifact_name ? String(row.artifact_name) : null,
    artifactSha256: row.artifact_sha256 ? String(row.artifact_sha256) : null,
    artifactBytes: row.artifact_bytes == null ? null : Number(row.artifact_bytes),
    sourceSha256: String(row.source_sha256 ?? ""),
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
}

const CARD_COLUMNS =
  "id, project_id, revision, status, mode, package_name, version_name, version_code, generator, toolkit, quota_state, cancel_requested, error, artifact_name, artifact_sha256, artifact_bytes, source_sha256, created_at, started_at, finished_at";

/** 执行中但 Worker 心跳超时的任务判失败并释放预扣（幂等：只有状态从 running 改掉的那次释放）。 */
export async function sweepStale(sql: Sql) {
  const stale = await sql.query<Row>(
    `select id from build_tasks where status = 'running' and coalesce(heartbeat_at, started_at) < now() - ($1 || ' seconds')::interval limit 20`,
    [String(STALE_SECONDS)],
  );
  for (const row of stale) await finishWithRelease(String(row.id), ["running"], "failed", "构建 Worker 失联，任务已判失败，预扣积分已释放");
}

/** 把任务从 from 状态改成终态并释放预扣。返回是否由这次调用完成。 */
async function finishWithRelease(taskId: string, from: string[], to: "failed" | "cancelled", message: string): Promise<boolean> {
  return withTransaction(async (tx) => {
    const rows = await tx.query<Row>(
      `update build_tasks set status = $2, error = $3, finished_at = now(),
         quota_state = case when quota_state = 'reserved' then 'released' else quota_state end
       where id = $1 and status = any($4::text[]) returning user_id, quota_state`,
      [taskId, to, message, from],
    );
    if (!rows.length) return false;
    if (rows[0].quota_state === "released") await release(tx, String(rows[0].user_id), "build", taskId, to === "cancelled" ? "构建取消，释放预扣" : "构建失败，释放预扣");
    return true;
  });
}

async function liveWorkers(sql: Sql) {
  return sql.query<Row>(`select id, toolkit, signing, sandbox from build_workers where seen_at > now() - ($1 || ' seconds')::interval`, [String(WORKER_ONLINE_SECONDS)]);
}

export async function handleBuildAction(sql: Sql, userId: string, action: BuildAction, body: Record<string, unknown>, deps: BuildDeps) {
  if (action === "requestBuild") return requestBuild(sql, userId, body, deps);
  await sweepStale(sql);
  if (action === "listBuilds") {
    const projectId = text(body.projectId, 48);
    const rows = await sql.query<Row>(
      `select ${CARD_COLUMNS} from build_tasks where user_id = $1 and ($2 = '' or project_id = $2) order by created_at desc limit 50`,
      [userId, projectId],
    );
    return rows.map(buildCard);
  }
  const taskId = text(body.id, 48);
  if (action === "getBuild") {
    const row = (await sql.query<Row>(`select ${CARD_COLUMNS}, log, verify, components, environment, runtime_sha256 from build_tasks where id = $1 and user_id = $2`, [taskId, userId]))[0];
    if (!row) throw notFound("没有这个构建任务");
    return { ...buildCard(row), log: String(row.log ?? ""), verify: row.verify ?? null, components: row.components ?? [], environment: row.environment ?? {}, runtimeSha256: String(row.runtime_sha256 ?? "") };
  }
  if (action === "cancelBuild") {
    const row = (await sql.query<Row>("select status from build_tasks where id = $1 and user_id = $2", [taskId, userId]))[0];
    if (!row) throw notFound("没有这个构建任务");
    if (await finishWithRelease(taskId, ["queued", "waiting"], "cancelled", "用户取消")) return { id: taskId, status: "cancelled", released: true };
    const flagged = await sql.query("update build_tasks set cancel_requested = true where id = $1 and user_id = $2 and status = 'running' returning id", [taskId, userId]);
    if (flagged.length) return { id: taskId, status: "running", cancelRequested: true };
    throw new ApiError(409, `任务已经${BUILD_STATUS_LABEL[String(row.status)] ?? "结束"}，不能取消`);
  }
  // downloadBuild：积分在构建成功时已确认，下载不再扣分。
  const row = (await sql.query<Row>("select status, artifact, artifact_name, artifact_sha256, artifact_bytes from build_tasks where id = $1 and user_id = $2", [taskId, userId]))[0];
  if (!row) throw notFound("没有这个构建任务");
  const data = bytesOf(row.artifact);
  if (row.status !== "succeeded" || !data) throw new ApiError(409, "只有构建成功的任务可以下载 RPK");
  return {
    fileName: String(row.artifact_name),
    sha256: String(row.artifact_sha256),
    bytes: Number(row.artifact_bytes),
    rpkBase64: Buffer.from(data).toString("base64"),
    artifactType: "rpk" as const,
  };
}

async function recordUnavailable(sql: Sql, userId: string, projectId: string, message: string) {
  const taskId = newId();
  await sql.query(
    `insert into build_tasks (id, user_id, project_id, revision, content_sha256, status, mode, package_name, version_name, version_code, generator, error, finished_at)
     values ($1,$2,$3,0,'','unavailable','debug','','',1,'',$4, now())`,
    [taskId, userId, projectId, message],
  );
  return { id: taskId, status: "unavailable", statusLabel: BUILD_STATUS_LABEL.unavailable, message, charged: false };
}

async function requestBuild(sql: Sql, userId: string, body: Record<string, unknown>, deps: BuildDeps) {
  const projectId = text(body.projectId, 48);
  const owned = (await sql.query("select id from projects where id = $1 and user_id = $2", [projectId, userId]))[0];
  if (!owned) throw notFound("找不到这个工程");
  if (deps.flags.build_enabled !== "true") return recordUnavailable(sql, userId, projectId, "RPK 构建暂未开放（后台未开启）。本次不扣 RPK 积分，也不会记成打包成功。");
  const workers = await liveWorkers(sql);
  if (!workers.length) return recordUnavailable(sql, userId, projectId, "当前没有在线的构建 Worker。本次不扣 RPK 积分，也不会记成打包成功。");

  // 固定工程修订：只构建服务端已保存的最新修订（客户端提交的内容不参与构建）。
  const loaded = await loadOwnedDoc(sql, userId, projectId);
  if (loaded.revision < 1) throw new ApiError(400, "工程还没有保存到云端，请先保存再构建");
  const doc = loaded.doc;

  // 组件授权：工程里每种组件当前都要有使用权限。
  const palette = await deps.palette();
  for (const page of doc.pages)
    for (const c of page.components) {
      const reason = palette[c.type];
      if (reason === undefined) throw new ApiError(400, `组件 ${c.type} 不在已上架目录，不能构建`);
      if (reason) throw new ApiError(403, `组件 ${c.name || c.type}：${reason}`);
    }

  const source = generateNative(doc);
  if (!source.ok) {
    const first = source.issues.find((i) => i.level === "error");
    throw new ApiError(400, `工程校验未通过：${first ? `${first.path} ${first.message}` : "未知错误"}`, { issues: source.issues.slice(0, 50) });
  }
  const signing = workers.some((w) => w.signing === true);
  const mode = signing ? "release" : "debug";
  const priority = await deps.priority();
  const concurrency = await deps.concurrency();
  const toolkit = String(workers[0].toolkit ?? "");

  return withTransaction(async (tx) => {
    // 锁住该用户的打包积分账户，同一用户的并发请求排队执行，防止双击重复预扣。
    await ensureQuota(tx, userId, "build");
    await tx.query("select balance from quota_accounts where user_id = $1 and kind = 'build' for update", [userId]);
    const same = (
      await tx.query<Row>(
        `select ${CARD_COLUMNS} from build_tasks where user_id = $1 and project_id = $2 and revision = $3 and mode = $4 and generator = $5
           and status in ('queued','waiting','running','succeeded') order by created_at desc limit 1`,
        [userId, projectId, loaded.revision, mode, source.generator],
      )
    )[0];
    if (same) return { ...buildCard(same), reused: true, charged: false, message: "同一修订已有构建任务，不重复扣分" };
    const taskId = newId();
    if (!(await reserve(tx, userId, "build", taskId)))
      throw new ApiError(400, "RPK 成品打包积分不足。编辑和保存仍然可用。购买打包积分不会解锁会员组件。");
    const active = (await tx.query<{ n: number }>("select count(*)::int as n from build_tasks where user_id = $1 and status in ('waiting','running')", [userId]))[0];
    const status = Number(active?.n ?? 0) >= concurrency ? "queued" : "waiting";
    const routes = doc.pages.map((p) => `pages/${p.name}`);
    const rows = await tx.query<Row>(
      `insert into build_tasks (id, user_id, project_id, revision, content_sha256, status, mode, package_name, version_name, version_code, routes,
         generator, runtime_sha256, components, source_sha256, source_zip, quota_state, priority, toolkit)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'reserved',$17,$18) returning ${CARD_COLUMNS}`,
      [
        taskId,
        userId,
        projectId,
        loaded.revision,
        loaded.contentSha256,
        status,
        mode,
        doc.project.packageName,
        doc.manifest.versionName,
        doc.manifest.versionCode,
        JSON.stringify(routes),
        source.generator,
        source.runtimeSha256,
        JSON.stringify(doc.dependencies),
        source.sha256,
        Buffer.from(source.zip),
        priority,
        toolkit,
      ],
    );
    return { ...buildCard(rows[0]), reused: false, charged: false, reserved: true, message: status === "queued" ? "已预扣 1 个打包积分，前面还有任务，排队中" : "已预扣 1 个打包积分，等待构建" };
  });
}
