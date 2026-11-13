import { createHash, randomBytes } from "node:crypto";
import { getSql, withTransaction, type Sql } from "@/lib/db";
import { ApiError, forbidden, notFound } from "./errors";
import { commitQuota, ensureQuota, grantQuota, reserve } from "./quota.server";
import { handleBuildAction, isBuildAction } from "./builds.server";
import { checkForSave, editorProjectFrom, editorToDoc, listRevisions, loadOwnedDoc, saveDoc, type SaveResult } from "./projects.server";
import { inspectBproj, packBproj } from "@/lib/protocol/bproj";
import { migrateToCurrent } from "@/lib/protocol/migrate";
import { generateNative } from "@/lib/generator/native";
import { docToProject, type EditorProject } from "@/lib/protocol/editor";
import { inflateRawSync } from "node:zlib";
import { normalizeProject, validateDsl, type Project, type Revision } from "@/lib/blueos/model";
import { CLIENTS, isSharedAction, type ClientKind } from "@/lib/contract/surface";
import {
  CONFIG_KEYS,
  QUOTA_KINDS,
  STARTER_QUOTA,
  FREE_PROJECT_LIMIT,
  accessReason,
  allows,
  isStaff,
  normalizeCode,
  roleChangeError,
  submissionIssues,
  type AccessRow,
  type QuotaKind,
} from "./policy";

type Row = Record<string, unknown>;

function id(prefix: string): string {
  return prefix + randomBytes(8).toString("hex");
}

function text(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function obj(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("参数不正确");
  return payload as Record<string, unknown>;
}

function asJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function stamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const time = stamp(value);
  return new Date(time).toISOString();
}

async function one<T extends Row>(sql: Sql, query: string, params: unknown[] = []): Promise<T | null> {
  const rows = await sql.query<T>(query, params);
  return rows[0] ?? null;
}

async function audit(sql: Sql, actorId: string, action: string, target: string, before: unknown, after: unknown) {
  await sql.query(
    "insert into audit_logs (id, actor_id, action, target, before, after) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)",
    [id("a"), actorId, action, target, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
}

async function configMap(sql: Sql): Promise<Record<string, string>> {
  const rows = await sql.query<{ key: string; value: string }>("select key, value from system_config");
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function rolesOf(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql.query<{ role: string }>("select role from user_roles where user_id = $1", [userId]);
  return rows.map((row) => row.role);
}

async function touchDevice(sql: Sql, userId: string, client: ClientKind) {
  try {
    await sql.query(
      `insert into client_devices (id, user_id, client, label, last_seen)
       values ($1,$2,$3,$4, now())
       on conflict (id) do update set last_seen = now(), label = excluded.label`,
      [`${client}:${userId}`, userId, client, client],
    );
  } catch {
    // 设备表还没迁移时不挡住登录信息。
  }
}

type Actor = {
  userId: string;
  email: string;
  name: string;
  status: string;
  developerStatus: string;
  roles: string[];
  created: boolean;
};

async function ensureActor(sql: Sql, userId: string): Promise<Actor> {
  const user = await one<{ email: string; name: string }>(sql, 'select email, name from "user" where id = $1', [userId]);
  if (!user) throw new Error("账号不存在");
  const existing = await one<{ status: string; developer_status: string }>(
    sql,
    "select status, developer_status from profiles where user_id = $1",
    [userId],
  );
  let created = false;
  if (!existing) {
    const open = (await configMap(sql)).registration_open !== "false";
    const supers = await one<{ count: number }>(sql, "select count(*)::int as count from user_roles where role = 'super_admin'");
    if ((supers?.count ?? 0) > 0 && !open) throw new Error("注册已关闭");
    const inserted = await sql.query(
      "insert into profiles (user_id, display_name) values ($1,$2) on conflict (user_id) do nothing returning user_id",
      [userId, user.name || ""],
    );
    created = inserted.length > 0;
  }
  // 首个超级管理员：设置了 BOOTSTRAP_ADMIN_EMAIL 时只允许该邮箱获得，避免生产首次部署被抢注；
  // 未设置时保持原行为（第一个账号成为超级管理员），方便本地试用。
  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const mayBootstrap = !bootstrapEmail || (user.email || "").toLowerCase() === bootstrapEmail;
  const promoted = mayBootstrap
    ? await sql.query(
        `insert into user_roles (user_id, role)
         select $1, 'super_admin'
         where not exists (select 1 from user_roles where role = 'super_admin')
         returning user_id`,
        [userId],
      )
    : [];
  if (promoted.length) await audit(sql, userId, "bootstrap.super_admin", userId, null, { role: "super_admin" });
  if (created) {
    for (const kind of QUOTA_KINDS) {
      const amount = STARTER_QUOTA[kind];
      await ensureQuota(sql, userId, kind);
      const starter = await sql.query(
        "select id from quota_ledger where user_id = $1 and ref = 'starter' and kind = $2 limit 1",
        [userId, kind],
      );
      if (amount > 0 && !starter.length) await grantQuota(sql, userId, kind, amount, "grant", "starter", "新账号初始额度");
    }
  }
  const profile = await one<{ status: string; developer_status: string }>(
    sql,
    "select status, developer_status from profiles where user_id = $1",
    [userId],
  );
  if (!profile) throw new Error("账号资料没有建立");
  if (profile.status === "banned") throw forbidden("账号已封禁");
  return {
    userId,
    email: user.email,
    name: user.name,
    status: profile.status,
    developerStatus: profile.developer_status,
    roles: await rolesOf(sql, userId),
    created,
  };
}

function requirePerm(actor: Actor, perm: string) {
  if (!allows(actor.roles, perm)) throw forbidden();
}

async function activeMembership(sql: Sql, userId: string) {
  return one<{ id: string; plan_id: string; ends_at: unknown; snapshot: unknown }>(
    sql,
    "select id, plan_id, ends_at, snapshot from memberships where user_id = $1 and ends_at > now() order by ends_at desc limit 1",
    [userId],
  );
}

async function quotaView(sql: Sql, userId: string) {
  const rows = await sql.query<{ kind: QuotaKind; balance: number; reserved: number }>(
    "select kind, balance, reserved from quota_accounts where user_id = $1",
    [userId],
  );
  const view = { generation: { balance: 0, reserved: 0 }, build: { balance: 0, reserved: 0 }, export: { balance: 0, reserved: 0 } };
  for (const row of rows) {
    if (row.kind in view) view[row.kind] = { balance: Number(row.balance), reserved: Number(row.reserved) };
  }
  return view;
}

async function componentRows(sql: Sql): Promise<AccessRow[]> {
  const rows = await sql.query<{ slug: string; access: string; status: string; name: string }>(
    "select slug, access, status, name from components",
  );
  return rows;
}

async function grantSet(sql: Sql, userId: string): Promise<Set<string>> {
  const rows = await sql.query<{ slug: string }>(
    `select c.slug from component_grants g join components c on c.id = g.component_id
     where g.user_id = $1 and (g.expires_at is null or g.expires_at > now())`,
    [userId],
  );
  return new Set(rows.map((row) => row.slug));
}

async function paletteFor(sql: Sql, userId: string, roles: string[]) {
  const [rows, member, grants] = await Promise.all([componentRows(sql), activeMembership(sql, userId), grantSet(sql, userId)]);
  const staff = allows(roles, "components.write");
  const palette: Record<string, string> = {};
  for (const row of rows) {
    palette[row.slug] = accessReason(row, { member: Boolean(member), granted: grants.has(row.slug), staff }) ?? "";
  }
  return palette;
}

function cleanProject(input: unknown): Project {
  const raw = JSON.stringify(input ?? null);
  if (raw.length > 400_000) throw new Error("工程过大");
  const project = input as Project;
  if (!project || typeof project !== "object") throw new Error("工程数据无效");
  if (!/^[a-z][a-z0-9]{6,40}$/.test(project.id || "")) throw new Error("工程编号无效");
  const name = text(project.name, 40);
  const appName = text(project.appName, 40);
  const packageName = text(project.packageName, 80);
  if (!name || !appName) throw new Error("请填写工程名和应用名");
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName)) throw new Error("包名要像 com.example.watch");
  if (project.device !== "watch-round" && project.device !== "watch-square") throw new Error("设备类型无效");
  if (!Array.isArray(project.pages) || project.pages.length < 1 || project.pages.length > 12) throw new Error("页面数量无效");
  let nodes = 0;
  for (const page of project.pages) nodes += Array.isArray(page.nodes) ? page.nodes.length : 0;
  if (nodes > 200) throw new Error("组件太多");
  const revisions = Array.isArray(project.revisions) ? project.revisions.slice(0, 30) : [];
  for (const revision of revisions) {
    if (!revision || typeof revision.snapshot !== "string" || revision.snapshot.length > 150_000) throw new Error("修订快照无效");
  }
  return normalizeProject({
    ...project,
    name,
    appName,
    packageName,
    designWidth: 466,
    revisions,
  });
}

async function projectCap(sql: Sql, userId: string): Promise<number> {
  const member = await activeMembership(sql, userId);
  if (!member) return FREE_PROJECT_LIMIT;
  const plan = await one<{ project_limit: number }>(sql, "select project_limit from plans where id = $1", [member.plan_id]);
  const limit = Number(plan?.project_limit ?? 20);
  if (!Number.isFinite(limit) || limit <= 0) return 1_000_000;
  return limit;
}

async function upsertProject(sql: Sql, userId: string, project: Project, client: ClientKind = "web"): Promise<SaveResult> {
  // 编辑器格式先转成协议，再做和其他客户端一样的结构校验（protocolExtras 来自客户端，不能直接信任）。
  const { doc } = checkForSave(editorToDoc(project as EditorProject));
  const extras = (project as EditorProject).protocolExtras;
  const result = await withTransaction((tx) =>
    saveDoc(tx, userId, doc, { baseRevision: extras ? extras.revision : undefined, projectCap: () => projectCap(tx, userId), client }),
  );
  if (!result.ok) return result;
  for (const revision of project.revisions) {
    if (!/^[a-z][a-z0-9]{6,40}$/.test(revision.id)) continue;
    await sql.query(
      `insert into project_revisions (id, project_id, user_id, rev, note, snapshot, source, client)
       values ($1,$2,$3, coalesce((select max(rev) from project_revisions where project_id = $2), 0) + 1, $4, $5, 'client', $6)
       on conflict (id) do nothing`,
      [revision.id, project.id, userId, text(revision.note, 80) || "修订", revision.snapshot, client],
    );
  }
  return result;
}

async function revisionsOf(sql: Sql, projectId: string): Promise<Revision[]> {
  const rows = await sql.query<{ id: string; note: string; snapshot: string; created_at: unknown }>(
    "select id, note, snapshot, created_at from project_revisions where project_id = $1 and source = 'client' order by rev desc limit 30",
    [projectId],
  );
  return rows.map((row) => ({ id: row.id, note: row.note, snapshot: row.snapshot, at: stamp(row.created_at) }));
}

async function listProjects(sql: Sql, userId: string): Promise<Project[]> {
  const rows = await sql.query<Row>(
    "select id, name, app_name, package_name, device, body, revision, updated_at from projects where user_id = $1 order by updated_at desc",
    [userId],
  );
  const projects: Project[] = [];
  for (const row of rows) {
    const project = editorProjectFrom(row, await revisionsOf(sql, String(row.id)));
    if (project) projects.push(project);
    else console.error("[projects] 无法读取工程", row.id);
  }
  return projects;
}

async function concurrencyLimit(sql: Sql, userId: string): Promise<number> {
  const member = await activeMembership(sql, userId);
  if (!member) return 1;
  const plan = await one<{ concurrency: number }>(sql, "select concurrency from plans where id = $1", [member.plan_id]);
  return Math.max(1, Number(plan?.concurrency ?? 1));
}

/**
 * 下载 .bproj 工程包。
 * - 只打包服务端已保存的工程内容（客户端提交的内容不参与打包，防止绕过授权）。
 * - 检查工程里每个组件当前是否有使用权限。
 * - 同一账号、同一工程、内容未变时重复下载不重复扣分（幂等键 = 工程 id + 内容摘要）。
 * - 预扣、确认、写流水、记任务在一个事务里完成，失败整体回滚。
 */
async function exportBundle(sql: Sql, actor: Actor, input: Record<string, unknown>) {
  const userId = actor.userId;
  const fromBody = input.project && typeof input.project === "object" ? (input.project as { id?: unknown }).id : undefined;
  const projectId = text(input.projectId ?? fromBody, 48);
  if (!projectId) throw new ApiError(400, "缺少工程编号");
  const owned = await one<Row>(sql, "select id from projects where id = $1 and user_id = $2", [projectId, userId]);
  if (!owned) throw notFound("请先保存到云端，再下载工程包");
  const { doc, contentSha256: digest } = await loadOwnedDoc(sql, userId, projectId);

  const palette = await paletteFor(sql, userId, actor.roles);
  const blocked = new Set<string>();
  for (const page of doc.pages) {
    for (const comp of page.components) {
      const reason = palette[comp.type];
      if (reason === undefined) blocked.add(`${comp.type} 不在已上架目录`);
      else if (reason) blocked.add(reason);
    }
  }
  if (blocked.size) throw forbidden(`工程里有当前账号未获授权的组件：${[...blocked].join("；")}`);

  const key = `bproj2:${doc.project.id}:${digest}`;
  const existing = await one<Row>(
    sql,
    "select id, status, file_name, sha256, artifact, exported from jobs where user_id = $1 and idempotency_key = $2",
    [userId, key],
  );
  if (existing?.status === "succeeded" && existing.exported && existing.artifact) {
    return {
      ok: true as const,
      fileName: String(existing.file_name),
      sha256: String(existing.sha256),
      zipBase64: String(existing.artifact),
      reused: true,
      charged: false,
      artifactType: "bproj" as const,
    };
  }

  const packed = await packBproj(doc);
  const zip = packed.bytes;
  const zipBase64 = Buffer.from(zip).toString("base64");
  const fileSha = packed.sha256;
  const fileName = `${doc.project.packageName.replace(/[^a-z0-9.]+/g, "") || "project"}.bproj`;
  const project = { id: doc.project.id };
  const revisionAt = doc.project.revision;

  return withTransaction(async (tx) => {
    // 并发的两次相同下载：先占位（冲突则等先到的事务提交），再加锁读取，后到的直接复用结果，不重复扣分。
    await tx.query(
      "insert into jobs (id, user_id, project_id, kind, status, idempotency_key, message, project_revision) values ($1,$2,$3,'export','failed',$4,'处理中',$5) on conflict (user_id, idempotency_key) do nothing",
      [id("job"), userId, project.id, key, revisionAt],
    );
    const done = await one<Row>(
      tx,
      "select id, status, file_name, sha256, artifact, exported from jobs where user_id = $1 and idempotency_key = $2 for update",
      [userId, key],
    );
    if (done?.status === "succeeded" && done.exported && done.artifact) {
      return {
        ok: true as const,
        fileName: String(done.file_name),
        sha256: String(done.sha256),
        zipBase64: String(done.artifact),
        reused: true,
        charged: false,
        artifactType: "bproj" as const,
      };
    }
    if (!done?.id) throw new Error("导出任务占位失败");
    const jobId = String(done.id);
    if (!(await reserve(tx, userId, "export", jobId))) throw new ApiError(400, "项目工程下载积分不足，请先获取工程下载积分");
    await commitQuota(tx, userId, "export", jobId);
    await tx.query(
      `update jobs set status = 'succeeded', message = $2, file_name = $3, sha256 = $4, artifact = $5, bytes = $6, exported = true where id = $1`,
      [jobId, "项目工程包已导出，不是 RPK", fileName, fileSha, zipBase64, zip.length],
    );
    return { ok: true as const, fileName, sha256: fileSha, zipBase64, reused: false, charged: true, artifactType: "bproj" as const };
  });
}

/**
 * 源工程生成（旧 DSL 入口，兼容旧客户端）：DSL 先迁移到协议 v2，再用原生生成器生成，
 * 和 RPK 构建用同一个生成器，逻辑不会被降级丢弃。
 */
function nativeArtifact(dsl: unknown) {
  const migrated = migrateToCurrent(dsl);
  if (!migrated.ok || !migrated.doc) return { ok: false as const, issues: migrated.issues.map((i) => ({ path: i.path, message: i.message, level: i.level })) };
  const out = generateNative(migrated.doc);
  if (!out.ok) return { ok: false as const, issues: out.issues };
  return {
    ok: true as const,
    artifactType: "source_zip" as const,
    compiled: false as const,
    fileName: out.fileName,
    sha256: out.sha256,
    zipBase64: Buffer.from(out.zip).toString("base64"),
    files: out.files.map((f) => ({ path: f.path, bytes: f.data.length, text: f.path.endsWith("engine.js") ? undefined : f.text })),
    notes: out.notes,
    issues: migrated.issues.filter((i) => i.level !== "error").map((i) => ({ path: i.path, message: i.message, level: i.level })),
  };
}

async function runGeneration(sql: Sql, userId: string, dslInput: unknown) {
  const flags = await configMap(sql);
  if (flags.generation_enabled === "false") throw new Error("生成已关闭");
  const { dsl, issues } = validateDsl(dslInput);
  if (!dsl) return { ok: false as const, issues };
  const actor = await ensureActor(sql, userId);
  const palette = await paletteFor(sql, userId, actor.roles);
  const blocked = [...issues];
  dsl.pages.forEach((page, pageIndex) => {
    page.components.forEach((component, index) => {
      const reason = palette[component.type];
      if (reason === undefined) {
        blocked.push({ path: `pages/${pageIndex}/components/${index}`, message: `${component.type} 不在已上架目录`, level: "error" });
      } else if (reason) {
        blocked.push({ path: `pages/${pageIndex}/components/${index}`, message: reason, level: "error" });
      }
    });
  });
  if (blocked.some((issue) => issue.level === "error")) return { ok: false as const, issues: blocked };

  const digest = createHash("sha256").update(JSON.stringify(dsl)).digest("hex");
  const key = `gen:${digest}`;
  const existing = await one<Row>(
    sql,
    "select id, status, message, file_name, sha256, artifact, exported from jobs where user_id = $1 and idempotency_key = $2",
    [userId, key],
  );
  if (existing?.status === "succeeded" && existing.artifact) {
    const again = nativeArtifact(dsl);
    return again.ok
      ? { ...again, zipBase64: existing.exported ? again.zipBase64 : null, jobId: String(existing.id), reused: true }
      : again;
  }

  const open = await one<{ count: number }>(
    sql,
    "select count(*)::int as count from jobs where user_id = $1 and status = 'succeeded' and created_at > now() - interval '2 seconds'",
    [userId],
  );
  const limit = await concurrencyLimit(sql, userId);
  if ((open?.count ?? 0) >= limit) throw new Error("生成太密，请稍后再试");

  const jobId = existing?.id ? String(existing.id) : id("job");
  if (!existing) {
    const inserted = await sql.query(
      "insert into jobs (id, user_id, project_id, kind, status, idempotency_key, message) values ($1,$2,$3,'generation','failed',$4,'处理中') on conflict (user_id, idempotency_key) do nothing returning id",
      [jobId, userId, dsl.project.id, key],
    );
    // 同一份 DSL 并发生成：后到的请求不重复扣额度。
    if (!inserted.length) throw new ApiError(409, "同样的内容正在生成，请稍后重试");
  }
  const artifact = nativeArtifact(dsl);
  if (!artifact.ok) {
    await sql.query("update jobs set status = 'failed', message = $2 where id = $1", [jobId, "DSL 校验失败"]);
    return artifact;
  }
  try {
    // 生成额度和导出额度的预扣、确认、流水、任务结果在同一个事务里，失败整体回滚。
    const exported = await withTransaction(async (tx) => {
      if (!(await reserve(tx, userId, "generation", jobId))) throw new ApiError(400, "生成额度不足");
      await commitQuota(tx, userId, "generation", jobId);
      let paid = false;
      if (await reserve(tx, userId, "export", jobId)) {
        await commitQuota(tx, userId, "export", jobId);
        paid = true;
      }
      await tx.query(
        `update jobs set status = 'succeeded', message = $2, file_name = $3, sha256 = $4, artifact = $5, bytes = $6, exported = $7
         where id = $1`,
        [
          jobId,
          paid ? "source_zip 已生成，未编译" : "source_zip 已生成，导出额度不足，压缩包暂不提供",
          artifact.fileName,
          artifact.sha256,
          artifact.zipBase64,
          artifact.zipBase64.length,
          paid,
        ],
      );
      return paid;
    });
    const notes = exported ? artifact.notes : [...artifact.notes, "导出额度不足。生成额度已确认，压缩包先留在任务里，补足导出额度后再下载。"];
    return {
      ...artifact,
      zipBase64: exported ? artifact.zipBase64 : null,
      notes,
      jobId,
      reused: false,
      compiled: false as const,
      artifactType: "source_zip" as const,
    };
  } catch (error) {
    await sql.query("update jobs set status = 'failed', message = $2 where id = $1", [jobId, error instanceof ApiError ? error.message : "生成失败"]);
    throw error;
  }
}

async function applyKey(sql: Sql, userId: string, type: string, payload: Record<string, unknown>, ref: string) {
  if (type === "membership" || (type === "custom" && payload.planId)) {
    const planId = text(payload.planId, 40);
    const plan = await one<Row>(sql, "select * from plans where id = $1 and active = true", [planId]);
    if (!plan) throw new Error("卡密里的套餐不存在");
    await giveMembership(sql, userId, plan, ref);
  }
  if (type === "quota" || type === "custom") {
    for (const kind of QUOTA_KINDS) {
      const amount = Number(payload[kind] ?? 0);
      if (amount > 0) await grantQuota(sql, userId, kind, Math.min(10_000, Math.floor(amount)), "grant", ref, "卡密充值");
    }
  }
  if (type === "component" || (type === "custom" && payload.componentId)) {
    const componentId = text(payload.componentId, 40);
    const found = await one(sql, "select id from components where id = $1", [componentId]);
    if (!found) throw new Error("卡密里的组件不存在");
    await sql.query(
      `insert into component_grants (user_id, component_id, source) values ($1,$2,$3)
       on conflict (user_id, component_id) do update set source = excluded.source`,
      [userId, componentId, ref],
    );
  }
}

async function giveMembership(sql: Sql, userId: string, plan: Row, source: string) {
  const current = await activeMembership(sql, userId);
  const start = current ? stamp(current.ends_at) : Date.now();
  const ends = new Date(start + Number(plan.duration_days) * 86_400_000);
  const snapshot = {
    id: plan.id,
    name: plan.name,
    slug: plan.slug,
    priceCents: plan.price_cents,
    durationDays: plan.duration_days,
    generation: plan.generation,
    build: plan.build_quota,
    export: plan.export_quota,
    concurrency: plan.concurrency,
    projectLimit: Number(plan.project_limit ?? 20),
    monthlyBuild: Number(plan.monthly_build ?? 0),
    bonusBuild: Number(plan.bonus_build ?? 0),
  };
  await sql.query(
    "insert into memberships (id, user_id, plan_id, snapshot, starts_at, ends_at, source) values ($1,$2,$3,$4::jsonb,$5,$6,$7)",
    [id("m"), userId, plan.id, JSON.stringify(snapshot), new Date(start).toISOString(), ends.toISOString(), source],
  );
  await grantQuota(sql, userId, "generation", Number(plan.generation), "grant", source, `套餐 ${String(plan.name)} 生成额度`);
  await grantQuota(sql, userId, "export", Number(plan.export_quota), "grant", source, `套餐 ${String(plan.name)} 导出额度`);
  const pack =
    Math.max(0, Number(plan.build_quota) || 0) +
    Math.max(0, Number(plan.monthly_build) || 0) +
    Math.max(0, Number(plan.bonus_build) || 0);
  if (pack > 0) await grantQuota(sql, userId, "build", pack, "grant", source, `套餐 ${String(plan.name)} 打包额度`);
}

function publicJob(row: Row) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    kind: String(row.kind),
    status: String(row.status),
    message: String(row.message ?? ""),
    fileName: row.file_name ? String(row.file_name) : null,
    sha256: row.sha256 ? String(row.sha256) : null,
    exported: Boolean(row.exported),
    createdAt: iso(row.created_at),
  };
}

async function me(sql: Sql, actor: Actor) {
  const membership = await activeMembership(sql, actor.userId);
  const quota = await quotaView(sql, actor.userId);
  const palette = await paletteFor(sql, actor.userId, actor.roles);
  const announcements = await sql.query<{ id: string; title: string; body: string }>(
    "select id, title, body from announcements where active = true order by created_at desc limit 5",
  );
  const plans = await sql.query<Row>("select * from plans where active = true order by price_cents");
  return {
    userId: actor.userId,
    email: actor.email,
    name: actor.name,
    status: actor.status,
    developerStatus: actor.developerStatus,
    roles: actor.roles,
    staff: isStaff(actor.roles),
    membership: membership
      ? { planId: membership.plan_id, endsAt: iso(membership.ends_at), snapshot: asJson(membership.snapshot) }
      : null,
    quota,
    palette,
    announcements,
    plans: plans.map(planCard),
    flags: await configMap(sql),
    clients: CLIENTS,
    release: await (async () => {
      const row = await latestRelease(sql);
      return row ? releaseCard(row) : null;
    })(),
  };
}

function releaseCard(row: Row) {
  return {
    id: String(row.id),
    channel: String(row.channel),
    versionName: String(row.version_name),
    versionCode: Number(row.version_code),
    minVersionCode: Number(row.min_version_code),
    force: Boolean(row.force_update),
    notes: String(row.notes ?? ""),
    apkUrl: String(row.apk_url ?? ""),
    sha256: String(row.sha256 ?? ""),
    sizeBytes: Number(row.size_bytes ?? 0),
    active: Boolean(row.active),
  };
}

async function latestRelease(sql: Sql, channel = "stable") {
  return one<Row>(
    sql,
    "select * from app_releases where active = true and channel = $1 order by version_code desc limit 1",
    [channel],
  );
}

function planCard(plan: Row) {
  return {
    id: String(plan.id),
    slug: String(plan.slug),
    name: String(plan.name),
    priceCents: Number(plan.price_cents),
    durationDays: Number(plan.duration_days),
    generation: Number(plan.generation),
    build: Number(plan.build_quota),
    export: Number(plan.export_quota),
    concurrency: Number(plan.concurrency),
    projectLimit: Number(plan.project_limit ?? 20),
    storageMb: Number(plan.storage_mb ?? 0),
    priority: Number(plan.priority ?? 0),
    dailyBuild: Number(plan.daily_build ?? 0),
    monthlyBuild: Number(plan.monthly_build ?? 0),
    bonusBuild: Number(plan.bonus_build ?? 0),
    categories: String(plan.categories ?? ""),
    active: Boolean(plan.active),
  };
}

function componentCard(row: Row, installed: boolean) {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    category: String(row.category),
    summary: String(row.summary),
    authorName: String(row.author_name),
    access: String(row.access),
    minPlan: String(row.min_plan ?? ""),
    status: String(row.status),
    latestVersion: String(row.latest_version),
    code: String(row.code ?? ""),
    installed,
  };
}

const MAX_IMPORT_BYTES = 600_000;

/**
 * 导入 .bproj：完整性/Schema/依赖校验 → 预览；正式导入总是新建工程，绝不覆盖已有工程。
 * 同一账号重复导入同一内容：返回已有工程（duplicate），除非 mode=copy。
 */
async function importBundle(sql: Sql, userId: string, body: Record<string, unknown>, client: ClientKind, previewOnly: boolean) {
  const b64 = typeof body.fileBase64 === "string" ? body.fileBase64 : "";
  if (!b64 || b64.length > Math.ceil((MAX_IMPORT_BYTES * 4) / 3) + 8) throw new ApiError(413, "工程包为空或过大");
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  const preview = await inspectBproj(bytes, (data) => new Uint8Array(inflateRawSync(data, { maxOutputLength: 4 * 1024 * 1024 })));
  const existing = preview.contentSha256
    ? await one<Row>(
        sql,
        `select i.project_id from project_imports i join projects p on p.id = i.project_id and p.user_id = i.user_id
         where i.user_id = $1 and i.content_sha256 = $2
         union all select id from projects where user_id = $1 and content_sha256 = $2 limit 1`,
        [userId, preview.contentSha256],
      )
    : null;
  const duplicateOf = existing ? String(existing.project_id ?? existing.id) : null;
  const report = { ok: preview.ok, from: preview.from, steps: preview.steps, integrity: preview.integrity, contentSha256: preview.contentSha256, issues: preview.issues.slice(0, 100), summary: preview.summary, duplicateOf };
  if (previewOnly) return report;
  if (!preview.doc) throw new ApiError(400, preview.issues[0]?.message ?? "工程包无效");
  if (preview.integrity === "failed") throw new ApiError(400, "工程包校验失败");
  const mode = body.mode === "copy" ? "copy" : "new";
  if (duplicateOf && mode !== "copy") return { ...report, imported: false, duplicate: true, projectId: duplicateOf };
  const doc = structuredClone(preview.doc);
  doc.project.id = `j${randomBytes(6).toString("hex")}`;
  doc.project.revision = 0;
  doc.project.createdAt = Date.now();
  if (duplicateOf) doc.project.name = `${doc.project.name.slice(0, 34)} 副本`;
  const saved = await withTransaction(async (tx) => {
    const res = await saveDoc(tx, userId, doc, { projectCap: () => projectCap(tx, userId), client });
    if (res.ok && preview.contentSha256) {
      await tx.query("insert into project_imports (user_id, content_sha256, project_id) values ($1,$2,$3) on conflict do nothing", [userId, preview.contentSha256, doc.project.id]);
    }
    return res;
  });
  if (!saved.ok) throw new ApiError(409, "导入冲突");
  return { ...report, imported: true, duplicate: false, projectId: doc.project.id, revision: saved.revision, project: docToProject({ ...doc, project: { ...doc.project, revision: saved.revision } }) };
}

export async function dispatch(userId: string, action: string, payload: unknown, client: ClientKind = "web"): Promise<unknown> {
  const sql = await getSql();
  const actor = await ensureActor(sql, userId);
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (!action.startsWith("admin") && !isSharedAction(action)) throw new Error("这个接口没有对客户端开放");

  if (action === "me") {
    await touchDevice(sql, userId, client);
    return { ...(await me(sql, actor)), client };
  }

  if (action === "listProjects") return listProjects(sql, userId);

  if (action === "syncProject") {
    const project = cleanProject(body.project);
    const result = await upsertProject(sql, userId, project, client);
    if (!result.ok) return { ok: false, conflict: true, serverRevision: result.serverRevision, serverProject: docToProject(result.serverDoc), message: result.message };
    return { ok: true, revision: result.revision, changed: result.changed, issues: result.issues.slice(0, 50) };
  }

  if (action === "getProjectDoc") {
    const revision = body.revision === undefined ? undefined : Number(body.revision);
    if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) throw new ApiError(400, "修订号无效");
    return loadOwnedDoc(sql, userId, text(body.projectId, 48), revision);
  }

  if (action === "saveProjectDoc") {
    const { doc } = checkForSave(body.doc);
    const baseRevision = body.baseRevision === undefined || body.baseRevision === null ? undefined : Number(body.baseRevision);
    if (baseRevision !== undefined && (!Number.isInteger(baseRevision) || baseRevision < 0)) throw new ApiError(400, "baseRevision 无效");
    const result = await withTransaction((tx) => saveDoc(tx, userId, doc, { baseRevision, projectCap: () => projectCap(tx, userId), client }));
    if (!result.ok) throw new ApiError(409, result.message, { conflict: true, serverRevision: result.serverRevision, serverDoc: result.serverDoc });
    return { ...result, issues: result.issues.slice(0, 50) };
  }

  if (action === "listRevisions") return listRevisions(sql, userId, text(body.projectId, 48));

  if (action === "validateProject") {
    const migrated = migrateToCurrent(body.doc);
    return { ok: migrated.ok, from: migrated.from, steps: migrated.steps, issues: migrated.issues.slice(0, 100) };
  }

  if (action === "previewImport" || action === "importBundle") return importBundle(sql, userId, body, client, action === "previewImport");

  if (action === "deleteProject") {
    const projectId = text(body.id, 48);
    await sql.query("delete from projects where id = $1 and user_id = $2", [projectId, userId]);
    return { ok: true };
  }

  if (action === "generate") return runGeneration(sql, userId, body.dsl);

  if (action === "exportBundle") return exportBundle(sql, actor, body);

  if (action === "listJobs") {
    const rows = await sql.query<Row>(
      "select id, project_id, kind, status, message, file_name, sha256, exported, created_at from jobs where user_id = $1 order by created_at desc limit 40",
      [userId],
    );
    return rows.map(publicJob);
  }

  if (action === "downloadJob") {
    const job = await one<Row>(
      sql,
      "select * from jobs where id = $1 and user_id = $2 and kind = 'generation'",
      [text(body.id, 48), userId],
    );
    if (!job || job.status !== "succeeded" || !job.artifact) throw notFound("没有可下载的源工程");
    if (!job.exported) {
      await withTransaction(async (tx) => {
        // 只有把 exported 从 false 改成 true 的那次请求扣分，并发重复点击不会重复扣。
        const flipped = await tx.query("update jobs set exported = true, message = $2 where id = $1 and exported = false returning id", [
          job.id,
          "source_zip 已导出，未编译",
        ]);
        if (!flipped.length) return;
        if (!(await reserve(tx, userId, "export", String(job.id)))) throw new ApiError(400, "导出额度不足");
        await commitQuota(tx, userId, "export", String(job.id));
      });
    }
    return {
      fileName: String(job.file_name),
      sha256: String(job.sha256),
      zipBase64: String(job.artifact),
      compiled: false,
      artifactType: "source_zip",
    };
  }

  if (isBuildAction(action)) {
    return handleBuildAction(sql, userId, action, body, {
      flags: await configMap(sql),
      palette: () => paletteFor(sql, userId, actor.roles),
      concurrency: () => concurrencyLimit(sql, userId),
      priority: async () => {
        const member = await activeMembership(sql, userId);
        if (!member) return 0;
        const plan = await one<{ priority: number }>(sql, "select priority from plans where id = $1", [member.plan_id]);
        return Number(plan?.priority ?? 0);
      },
    });
  }

  if (action === "releaseCheck") {
    const versionCode = Math.max(0, Math.floor(Number(body.versionCode ?? 0)));
    const channel = body.channel === "beta" ? "beta" : "stable";
    const release = await latestRelease(sql, channel);
    const flags = await configMap(sql);
    if (!release) return { update: false, force: false, release: null, flags };
    const latest = Number(release.version_code);
    const minimum = Number(release.min_version_code);
    return {
      update: versionCode > 0 && latest > versionCode,
      force: versionCode > 0 && (Boolean(release.force_update) || versionCode < minimum),
      release: releaseCard(release),
      flags,
    };
  }

  if (action === "market") {
    const rows = await sql.query<Row>("select * from components where status = 'published' and access <> 'internal' order by category, name");
    const installed = await sql.query<{ component_id: string }>("select component_id from component_installs where user_id = $1", [userId]);
    const have = new Set(installed.map((row) => row.component_id));
    return rows.map((row) => componentCard(row, have.has(String(row.id))));
  }

  if (action === "install") {
    const flags = await configMap(sql);
    if (flags.marketplace_open === "false") throw new Error("商城已关闭");
    const component = await one<Row>(sql, "select * from components where id = $1", [text(body.componentId, 48)]);
    if (!component) throw new Error("组件不存在");
    const palette = await paletteFor(sql, userId, actor.roles);
    const reason = palette[String(component.slug)];
    if (reason) throw new Error(reason);
    await sql.query(
      `insert into component_installs (user_id, component_id, version) values ($1,$2,$3)
       on conflict (user_id, component_id) do update set version = excluded.version, installed_at = now()`,
      [userId, component.id, component.latest_version],
    );
    return { ok: true };
  }

  if (action === "redeem") {
    const code = normalizeCode(text(body.code, 40));
    if (!/^BH-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)) throw new Error("卡密格式不对");
    const hash = createHash("sha256").update(code).digest("hex");
    const found = await one<Row>(sql, "select * from license_keys where code_hash = $1", [hash]);
    if (!found) {
      await sql.query("insert into license_activations (id, key_id, user_id, result) values ($1,$2,$3,$4)", [id("la"), "missing", userId, "not_found"]);
      throw notFound("卡密不存在");
    }
    if (found.status === "frozen") throw new Error("卡密已冻结");
    if (found.status === "void") throw new Error("卡密已作废");
    if (found.status === "used") throw new ApiError(409, "卡密已使用");
    if (found.expires_at && stamp(found.expires_at) < Date.now()) {
      await sql.query("update license_keys set status = 'expired' where id = $1 and status = 'unused'", [found.id]);
      throw new Error("卡密已过期");
    }
    const payload = asJson(found.payload) as Record<string, unknown>;
    // 标记已用、发放权益、写兑换记录在一个事务里；发放失败时卡密自动回到未使用。
    await withTransaction(async (tx) => {
      const updated = await tx.query(
        "update license_keys set status = 'used', used_by = $2, used_at = now() where id = $1 and status = 'unused' returning id",
        [found.id, userId],
      );
      if (!updated.length) throw new ApiError(409, "卡密已使用");
      await applyKey(tx, userId, String(found.type), payload, String(found.id));
      await tx.query("insert into license_activations (id, key_id, user_id, result) values ($1,$2,$3,'ok')", [id("la"), found.id, userId]);
    });
    return { ok: true, type: found.type };
  }

  if (action === "listOrders") {
    const rows = await sql.query<Row>("select * from orders where user_id = $1 order by created_at desc limit 20", [userId]);
    return rows.map(orderCard);
  }

  if (action === "createOrder") {
    if ((await configMap(sql)).membership_open === "false") throw forbidden("会员购买已关闭");
    const plan = await one<Row>(sql, "select * from plans where id = $1 and active = true", [text(body.planId, 40)]);
    if (!plan) throw new Error("套餐不存在");
    const orderId = id("o");
    const snapshot = planCard(plan);
    await sql.query(
      "insert into orders (id, user_id, plan_id, status, amount_cents, snapshot, note) values ($1,$2,$3,'pending',$4,$5::jsonb,$6)",
      [orderId, userId, plan.id, plan.price_cents, JSON.stringify(snapshot), "等待人工确认，没有自动扣款"],
    );
    return { id: orderId };
  }

  if (action === "developerApply") {
    if (actor.developerStatus === "approved") return { status: "approved" };
    if (actor.developerStatus === "suspended") throw new Error("投稿权限已暂停");
    await sql.query("update profiles set developer_status = 'pending' where user_id = $1", [userId]);
    return { status: "pending" };
  }

  if (action === "mySubmissions") {
    const rows = await sql.query<Row>("select * from submissions where user_id = $1 order by created_at desc limit 30", [userId]);
    return rows.map(submissionCard);
  }

  if (action === "submitComponent") {
    const flags = await configMap(sql);
    if (flags.submissions_open === "false") throw new Error("投稿已关闭");
    if (actor.developerStatus !== "approved") throw new Error("开发者资格还没通过");
    const draft = {
      name: text(body.name, 40),
      slug: text(body.slug, 40).toLowerCase(),
      category: text(body.category, 20),
      summary: text(body.summary, 400),
      version: text(body.version, 20),
      schemaText: text(typeof body.schemaText === "string" ? body.schemaText : "", 20_000),
    };
    const issues = submissionIssues(draft);
    const checks = { issues, at: new Date().toISOString(), policy: "machine-v1" };
    if (issues.length && flags.auto_publish === "true") {
      const submissionId = id("s");
      await sql.query(
        `insert into submissions (id, user_id, name, slug, category, summary, version, schema, status, review_note, checks)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'pending',$9,$10::jsonb)`,
        [submissionId, userId, draft.name, draft.slug, draft.category, draft.summary, draft.version, draft.schemaText || "{}", "机器检查未通过，等待人工处理", JSON.stringify(checks)],
      );
      return { id: submissionId, status: "pending", issues };
    }
    if (issues.length) throw new Error(issues[0] || "投稿没有通过检查");
    const taken = await one(sql, "select id from components where slug = $1", [draft.slug]);
    if (taken) throw new Error("这个标识已经被占用");
    const auto = flags.auto_publish === "true";
    const submissionId = id("s");
    await sql.query(
      `insert into submissions (id, user_id, name, slug, category, summary, version, schema, status, review_note, checks, reviewer_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12)`,
      [
        submissionId,
        userId,
        draft.name,
        draft.slug,
        draft.category,
        draft.summary,
        draft.version,
        draft.schemaText,
        auto ? "approved" : "pending",
        auto ? "机器检查通过后自动上架" : "",
        JSON.stringify(checks),
        auto ? "policy:auto" : null,
      ],
    );
    if (auto) await publishSubmission(sql, userId, draft);
    return { id: submissionId, status: auto ? "approved" : "pending", issues: [] };
  }

  if (action === "adminOverview") {
    if (!isStaff(actor.roles)) throw forbidden();
    const [users, members, components, pending, jobs, failed] = await Promise.all([
      one<{ count: number }>(sql, 'select count(*)::int as count from "user"'),
      one<{ count: number }>(sql, "select count(distinct user_id)::int as count from memberships where ends_at > now()"),
      one<{ count: number }>(sql, "select count(*)::int as count from components where status = 'published'"),
      one<{ count: number }>(sql, "select count(*)::int as count from submissions where status = 'pending'"),
      one<{ count: number }>(sql, "select count(*)::int as count from jobs where kind = 'generation' and status = 'succeeded'"),
      one<{ count: number }>(sql, "select count(*)::int as count from jobs where status = 'failed'"),
    ]);
    return {
      users: users?.count ?? 0,
      members: members?.count ?? 0,
      components: components?.count ?? 0,
      pending: pending?.count ?? 0,
      generated: jobs?.count ?? 0,
      failed: failed?.count ?? 0,
      flags: await configMap(sql),
      note: "构建成功数为 0 是预期结果：官方编译器未验证，unavailable 不会被算作成功。",
    };
  }

  if (action === "adminUsers") {
    requirePerm(actor, "users.read");
    const query = text(body.query, 80);
    const rows = await sql.query<Row>(
      `select u.id, u.email, u.name, u."createdAt" as created_at, p.status, p.developer_status
       from "user" u
       left join profiles p on p.user_id = u.id
       where $1 = '' or u.email ilike '%' || $1 || '%' or u.name ilike '%' || $1 || '%'
       order by u."createdAt" desc
       limit 40`,
      [query],
    );
    const list = [];
    for (const row of rows) {
      const idValue = String(row.id);
      list.push({
        id: idValue,
        email: String(row.email),
        name: String(row.name),
        status: row.status ? String(row.status) : "active",
        developerStatus: row.developer_status ? String(row.developer_status) : "none",
        roles: await rolesOf(sql, idValue),
        createdAt: iso(row.created_at),
      });
    }
    return list;
  }

  if (action === "adminUser") {
    requirePerm(actor, "users.read");
    const target = text(body.userId, 80);
    const quota = await quotaView(sql, target);
    const membership = await activeMembership(sql, target);
    const projects = await one<{ count: number }>(sql, "select count(*)::int as count from projects where user_id = $1", [target]);
    const jobs = await sql.query<Row>(
      "select id, kind, status, message, created_at from jobs where user_id = $1 order by created_at desc limit 8",
      [target],
    );
    return {
      quota,
      membership: membership ? { endsAt: iso(membership.ends_at), snapshot: asJson(membership.snapshot) } : null,
      projects: projects?.count ?? 0,
      jobs: jobs.map((row) => ({ id: String(row.id), kind: String(row.kind), status: String(row.status), message: String(row.message), createdAt: iso(row.created_at) })),
    };
  }

  if (action === "adminSetStatus") {
    requirePerm(actor, "users.ban");
    const target = text(body.userId, 80);
    const status = body.status === "banned" ? "banned" : "active";
    if (target === userId && status === "banned") throw new ApiError(400, "不能封禁自己");
    const targetRoles = await rolesOf(sql, target);
    if (targetRoles.includes("super_admin") && !actor.roles.includes("super_admin")) throw forbidden("只有超级管理员能封禁超级管理员");
    if (targetRoles.includes("admin") && !actor.roles.includes("super_admin")) throw forbidden("只有超级管理员能封禁管理员");
    await withTransaction(async (tx) => {
      await tx.query(
        "insert into profiles (user_id, display_name, status) values ($1,'',$2) on conflict (user_id) do update set status = excluded.status",
        [target, status],
      );
      // 封禁立即生效：吊销该账号所有已登录会话（网页、Android、桌面）。
      if (status === "banned") await tx.query('delete from "session" where "userId" = $1', [target]);
      await audit(tx, userId, "user.status", target, null, { status });
    });
    return { ok: true };
  }

  if (action === "adminSetRole") {
    const target = text(body.userId, 80);
    const role = text(body.role, 40);
    const grant = Boolean(body.grant);
    const targetRoles = await rolesOf(sql, target);
    const supers = await one<{ count: number }>(sql, "select count(*)::int as count from user_roles where role = 'super_admin'");
    const message = roleChangeError({
      actorId: userId,
      actorRoles: actor.roles,
      targetId: target,
      targetRoles,
      role,
      grant,
      superAdminCount: supers?.count ?? 0,
    });
    if (message) throw new Error(message);
    if (grant) await sql.query("insert into user_roles (user_id, role) values ($1,$2) on conflict do nothing", [target, role]);
    else await sql.query("delete from user_roles where user_id = $1 and role = $2", [target, role]);
    await audit(sql, userId, "user.role", target, { roles: targetRoles }, { role, grant });
    return { ok: true };
  }

  if (action === "adminGrantQuota") {
    requirePerm(actor, "users.quota");
    const target = text(body.userId, 80);
    const kind = text(body.kind, 20) as QuotaKind;
    const delta = Math.floor(Number(body.delta));
    if (!QUOTA_KINDS.includes(kind) || !Number.isInteger(delta) || delta < -1000 || delta > 1000 || delta === 0) throw new Error("额度调整无效");
    await withTransaction(async (tx) => {
      await grantQuota(tx, target, kind, delta, "adjust", `admin:${userId}`, text(body.note, 80) || "管理员调整");
      await audit(tx, userId, "quota.adjust", target, null, { kind, delta });
    });
    return { ok: true };
  }

  if (action === "adminGrantMembership") {
    requirePerm(actor, "users.membership");
    const target = text(body.userId, 80);
    const plan = await one<Row>(sql, "select * from plans where id = $1", [text(body.planId, 40)]);
    if (!plan) throw new Error("套餐不存在");
    await withTransaction(async (tx) => {
      await giveMembership(tx, target, plan, `admin:${userId}`);
      await audit(tx, userId, "membership.grant", target, null, { planId: plan.id });
    });
    return { ok: true };
  }

  if (action === "adminGrantComponent") {
    requirePerm(actor, "users.membership");
    const target = text(body.userId, 80);
    const componentId = text(body.componentId, 40);
    const found = await one(sql, "select id from components where id = $1", [componentId]);
    if (!found) throw new Error("组件不存在");
    await sql.query(
      "insert into component_grants (user_id, component_id, source) values ($1,$2,$3) on conflict (user_id, component_id) do update set source = excluded.source",
      [target, componentId, `admin:${userId}`],
    );
    await audit(sql, userId, "component.grant", target, null, { componentId });
    return { ok: true };
  }

  if (action === "adminSetDeveloper") {
    requirePerm(actor, "developer.review");
    const target = text(body.userId, 80);
    const status = text(body.status, 20);
    if (!["none", "pending", "approved", "suspended"].includes(status)) throw new Error("状态无效");
    await sql.query("update profiles set developer_status = $2 where user_id = $1", [target, status]);
    await audit(sql, userId, "developer.status", target, null, { status });
    return { ok: true };
  }

  if (action === "adminComponents") {
    requirePerm(actor, "components.write");
    const rows = await sql.query<Row>("select * from components order by category, name");
    return rows.map((row) => componentCard(row, false));
  }

  if (action === "adminSetComponent") {
    requirePerm(actor, "components.write");
    const componentId = text(body.id, 40);
    const status = body.status === "unpublished" ? "unpublished" : "published";
    const access = text(body.access, 40);
    if (!["public_free", "membership", "license_key", "specific_user", "internal", "disabled"].includes(access)) throw new Error("授权类型无效");
    const before = await one(sql, "select status, access from components where id = $1", [componentId]);
    if (!before) throw new Error("组件不存在");
    await sql.query("update components set status = $2, access = $3 where id = $1", [componentId, status, access]);
    await audit(sql, userId, "component.update", componentId, before, { status, access });
    return { ok: true };
  }

  if (action === "adminSubmissions") {
    requirePerm(actor, "submissions.review");
    const rows = await sql.query<Row>("select * from submissions order by created_at desc limit 40");
    return rows.map(submissionCard);
  }

  if (action === "adminReview") {
    requirePerm(actor, "submissions.review");
    const submissionId = text(body.id, 48);
    const decision = text(body.decision, 20);
    const note = text(body.note, 400);
    const row = await one<Row>(sql, "select * from submissions where id = $1", [submissionId]);
    if (!row) throw new Error("投稿不存在");
    if (!["approve", "reject", "changes"].includes(decision)) throw new Error("决定无效");
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes";
    if (decision === "approve") {
      const issues = asJson(row.checks) as { issues?: string[] };
      if (issues?.issues?.length) throw new Error("机器检查未通过，不能上架");
      const taken = await one(sql, "select id from components where slug = $1", [row.slug]);
      if (!taken) {
        await publishSubmission(sql, String(row.user_id), {
          name: String(row.name),
          slug: String(row.slug),
          category: String(row.category),
          summary: String(row.summary),
          version: String(row.version),
          schemaText: JSON.stringify(asJson(row.schema)),
        });
      }
    }
    await sql.query("update submissions set status = $2, review_note = $3, reviewer_id = $4 where id = $1", [submissionId, status, note, userId]);
    await audit(sql, userId, "submission.review", submissionId, { status: row.status }, { status, note });
    return { ok: true };
  }

  if (action === "adminPlans") {
    requirePerm(actor, "plans.write");
    const rows = await sql.query<Row>("select * from plans order by price_cents");
    return rows.map(planCard);
  }

  if (action === "adminSavePlan") {
    requirePerm(actor, "plans.write");
    const plan = obj(body.plan);
    const planId = text(plan.id, 40);
    const slug = text(plan.slug, 32).toLowerCase();
    const next = {
      name: text(plan.name, 40),
      priceCents: Math.max(0, Math.floor(Number(plan.priceCents))),
      durationDays: Math.min(3650, Math.max(1, Math.floor(Number(plan.durationDays)))),
      generation: Math.min(100_000, Math.max(0, Math.floor(Number(plan.generation)))),
      build: Math.min(100_000, Math.max(0, Math.floor(Number(plan.build)))),
      export: Math.min(100_000, Math.max(0, Math.floor(Number(plan.export)))),
      concurrency: Math.min(8, Math.max(1, Math.floor(Number(plan.concurrency)))),
      projectLimit: Math.min(1_000_000, Math.max(0, Math.floor(Number(plan.projectLimit ?? 20)))),
      storageMb: Math.min(1_000_000, Math.max(0, Math.floor(Number(plan.storageMb ?? 200)))),
      priority: Math.min(9, Math.max(0, Math.floor(Number(plan.priority ?? 0)))),
      monthlyBuild: Math.min(100_000, Math.max(0, Math.floor(Number(plan.monthlyBuild ?? 0)))),
      bonusBuild: Math.min(100_000, Math.max(0, Math.floor(Number(plan.bonusBuild ?? 0)))),
      dailyBuild: Math.min(100_000, Math.max(0, Math.floor(Number(plan.dailyBuild ?? 0)))),
      categories: text(plan.categories, 80),
      active: plan.active !== false,
    };
    if (!planId || !next.name || !/^[a-z][a-z0-9-]{1,32}$/.test(slug)) throw new Error("套餐不完整");
    const slugOwner = await one<{ id: string }>(sql, "select id from plans where slug = $1", [slug]);
    if (slugOwner && slugOwner.id !== planId) throw new Error("套餐标识已存在");
    const before = await one(sql, "select name, price_cents from plans where id = $1", [planId]);
    await sql.query(
      `insert into plans (
         id, slug, name, price_cents, duration_days, generation, build_quota, export_quota, concurrency, active,
         daily_build, monthly_build, bonus_build, project_limit, storage_mb, priority, categories
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       on conflict (id) do update set
         slug = excluded.slug,
         name = excluded.name,
         price_cents = excluded.price_cents,
         duration_days = excluded.duration_days,
         generation = excluded.generation,
         build_quota = excluded.build_quota,
         export_quota = excluded.export_quota,
         concurrency = excluded.concurrency,
         active = excluded.active,
         daily_build = excluded.daily_build,
         monthly_build = excluded.monthly_build,
         bonus_build = excluded.bonus_build,
         project_limit = excluded.project_limit,
         storage_mb = excluded.storage_mb,
         priority = excluded.priority,
         categories = excluded.categories`,
      [
        planId,
        slug,
        next.name,
        next.priceCents,
        next.durationDays,
        next.generation,
        next.build,
        next.export,
        next.concurrency,
        next.active,
        next.dailyBuild,
        next.monthlyBuild,
        next.bonusBuild,
        next.projectLimit,
        next.storageMb,
        next.priority,
        next.categories,
      ],
    );
    await audit(sql, userId, "plan.update", planId, before, next);
    return { ok: true };
  }

  if (action === "adminCreateKeys") {
    requirePerm(actor, "keys.write");
    const type = text(body.type, 20);
    if (!["membership", "quota", "component", "custom"].includes(type)) throw new Error("卡密类型无效");
    const quantity = Math.min(50, Math.max(1, Math.floor(Number(body.quantity))));
    const title = text(body.title, 60) || "卡密批次";
    const payload = obj(body.payload);
    const days = Math.floor(Number(body.expiresInDays ?? 0));
    const expires = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    if (type === "membership" || payload.planId) {
      const plan = await one(sql, "select id from plans where id = $1", [text(payload.planId, 40)]);
      if (!plan) throw new Error("套餐不存在");
    }
    if (type === "component" || payload.componentId) {
      const component = await one(sql, "select id from components where id = $1", [text(payload.componentId, 40)]);
      if ((type === "component" || payload.componentId) && !component) throw new Error("组件不存在");
    }
    const batchId = id("b");
    await sql.query(
      "insert into license_batches (id, type, title, payload, quantity, created_by) values ($1,$2,$3,$4::jsonb,$5,$6)",
      [batchId, type, title, JSON.stringify(payload), quantity, userId],
    );
    const codes: string[] = [];
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let index = 0; index < quantity; index += 1) {
      const chunk = () => Array.from(randomBytes(4), (byte) => alphabet[byte % alphabet.length]).join("");
      const code = `BH-${chunk()}-${chunk()}`;
      codes.push(code);
      await sql.query(
        "insert into license_keys (id, batch_id, code_hash, hint, type, payload, status, expires_at) values ($1,$2,$3,$4,$5,$6::jsonb,'unused',$7)",
        [id("k"), batchId, createHash("sha256").update(code).digest("hex"), `${code.slice(0, 7)}****`, type, JSON.stringify(payload), expires],
      );
    }
    await audit(sql, userId, "keys.create", batchId, null, { type, quantity });
    return { batchId, codes };
  }

  if (action === "adminKeys") {
    requirePerm(actor, "keys.write");
    const rows = await sql.query<Row>(
      `select k.id, k.hint, k.type, k.status, k.expires_at, k.used_at, b.title
       from license_keys k join license_batches b on b.id = k.batch_id
       order by k.used_at desc nulls last, k.id desc limit 60`,
    );
    return rows.map((row) => ({
      id: String(row.id),
      hint: String(row.hint),
      type: String(row.type),
      status: String(row.status),
      title: String(row.title),
      expiresAt: iso(row.expires_at),
      usedAt: iso(row.used_at),
    }));
  }

  if (action === "adminSetKey") {
    requirePerm(actor, "keys.write");
    const keyId = text(body.id, 48);
    const status = body.status === "void" ? "void" : "frozen";
    const updated = await sql.query(
      "update license_keys set status = $2 where id = $1 and status = 'unused' returning id",
      [keyId, status],
    );
    if (!updated.length) throw new Error("只能冻结或作废未使用的卡密");
    await audit(sql, userId, "keys.status", keyId, { status: "unused" }, { status });
    return { ok: true };
  }

  if (action === "adminOrders") {
    requirePerm(actor, "orders.confirm");
    const rows = await sql.query<Row>("select * from orders order by created_at desc limit 40");
    return rows.map(orderCard);
  }

  if (action === "adminConfirmOrder") {
    requirePerm(actor, "orders.confirm");
    const orderId = text(body.id, 48);
    const decision = body.decision === "cancel" ? "cancel" : "confirm";
    const note = text(body.note, 200);
    // 先用条件更新「抢占」订单状态，两个管理员同时确认时只有一个会发放权益。
    await withTransaction(async (tx) => {
      const next = decision === "cancel" ? "cancelled" : "confirmed";
      const order = await one<Row>(
        tx,
        "update orders set status = $2, note = $3 where id = $1 and status = 'pending' returning *",
        [orderId, next, note || (decision === "cancel" ? "已取消" : "人工确认开通")],
      );
      if (!order) throw new ApiError(409, "订单不在待确认状态");
      if (decision === "confirm") {
        const plan = await one<Row>(tx, "select * from plans where id = $1", [order.plan_id]);
        if (!plan) throw notFound("套餐已不存在");
        await giveMembership(tx, String(order.user_id), plan, `order:${orderId}`);
      }
      await audit(tx, userId, `order.${decision}`, orderId, { status: "pending" }, { status: next });
    });
    return { ok: true };
  }

  if (action === "adminRefundOrder") {
    requirePerm(actor, "orders.confirm");
    const orderId = text(body.id, 48);
    const note = text(body.note, 200) || "后台撤销";
    const shortfall = await withTransaction(async (tx) => {
      const order = await one<Row>(
        tx,
        "update orders set status = 'refunded', note = $2 where id = $1 and status = 'confirmed' returning *",
        [orderId, note],
      );
      if (!order) throw new ApiError(409, "只有已开通的订单可以撤销");
      const target = String(order.user_id);
      const source = `order:${orderId}`;
      // 只结束这笔订单开通的会员段；其他订单、卡密、后台发放的会员不受影响。
      await tx.query(
        "update memberships set ends_at = greatest(least(ends_at, now()), starts_at) where user_id = $1 and source = $2",
        [target, source],
      );
      // 按这笔订单实际发放的流水扣回；余额不够时扣到可用余额为止，并记录差额。
      const granted = await tx.query<{ kind: QuotaKind; amount: number }>(
        "select kind, sum(delta)::int as amount from quota_ledger where user_id = $1 and ref = $2 and phase = 'grant' group by kind",
        [target, source],
      );
      const missing: Record<string, number> = {};
      for (const row of granted) {
        const amount = Math.max(0, Number(row.amount) || 0);
        if (!amount) continue;
        await ensureQuota(tx, target, row.kind);
        const account = await one<{ balance: number; reserved: number }>(
          tx,
          "select balance, reserved from quota_accounts where user_id = $1 and kind = $2 for update",
          [target, row.kind],
        );
        const available = Math.max(0, Number(account?.balance ?? 0) - Number(account?.reserved ?? 0));
        const take = Math.min(amount, available);
        if (take > 0) await grantQuota(tx, target, row.kind, -take, "adjust", `refund:${orderId}`, "撤销订单扣回");
        if (take < amount) missing[row.kind] = amount - take;
      }
      await audit(tx, userId, "order.refund", orderId, { status: "confirmed" }, { status: "refunded", shortfall: missing });
      return missing;
    });
    return { ok: true, shortfall };
  }

  if (action === "adminJobs") {
    requirePerm(actor, "jobs.read");
    const rows = await sql.query<Row>(
      "select id, user_id, project_id, kind, status, message, file_name, sha256, created_at from jobs order by created_at desc limit 40",
    );
    return rows.map((row) => ({ ...publicJob(row), userId: String(row.user_id) }));
  }

  if (action === "adminAnnouncements") {
    requirePerm(actor, "announce.write");
    const rows = await sql.query<Row>("select id, title, body, active, created_at from announcements order by created_at desc limit 20");
    return rows.map((row) => ({ id: String(row.id), title: String(row.title), body: String(row.body), active: Boolean(row.active), createdAt: iso(row.created_at) }));
  }

  if (action === "adminSaveAnnouncement") {
    requirePerm(actor, "announce.write");
    const title = text(body.title, 60);
    const message = text(body.body, 600);
    const active = body.active !== false;
    if (!title || !message) throw new Error("公告不完整");
    const announcementId = text(body.id, 40) || id("ann");
    await sql.query(
      `insert into announcements (id, title, body, active) values ($1,$2,$3,$4)
       on conflict (id) do update set title = excluded.title, body = excluded.body, active = excluded.active`,
      [announcementId, title, message, active],
    );
    await audit(sql, userId, "announcement.save", announcementId, null, { title, active });
    return { ok: true };
  }

  if (action === "adminConfig") {
    requirePerm(actor, "config.write");
    return configMap(sql);
  }

  if (action === "adminSetConfig") {
    requirePerm(actor, "config.write");
    const key = text(body.key, 40);
    const value = body.value === true || body.value === "true" ? "true" : "false";
    if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number])) throw new Error("没有这个开关");
    const before = await configMap(sql);
    await sql.query(
      "insert into system_config (key, value) values ($1,$2) on conflict (key) do update set value = excluded.value",
      [key, value],
    );
    await audit(sql, userId, "config.update", key, { value: before[key] }, { value });
    return { ok: true };
  }

  if (action === "adminAudit") {
    requirePerm(actor, "audit.read");
    const rows = await sql.query<Row>("select id, actor_id, action, target, before, after, created_at from audit_logs order by created_at desc limit 50");
    return rows.map((row) => ({
      id: String(row.id),
      actorId: String(row.actor_id),
      action: String(row.action),
      target: String(row.target),
      before: asJson(row.before),
      after: asJson(row.after),
      createdAt: iso(row.created_at),
    }));
  }

  if (action === "adminReleases") {
    requirePerm(actor, "config.write");
    const rows = await sql.query<Row>("select * from app_releases order by version_code desc limit 30");
    return rows.map(releaseCard);
  }

  if (action === "adminSaveRelease") {
    requirePerm(actor, "config.write");
    const release = obj(body.release);
    const releaseId = text(release.id, 40) || id("rel");
    const channel = release.channel === "beta" ? "beta" : "stable";
    const versionName = text(release.versionName, 20);
    const versionCode = Math.max(1, Math.floor(Number(release.versionCode)));
    const minVersionCode = Math.max(1, Math.floor(Number(release.minVersionCode || 1)));
    if (!versionName) throw new Error("请填写版本名");
    const apkUrl = text(release.apkUrl, 300);
    const sha = text(release.sha256, 64).toLowerCase();
    if (sha && !/^[a-f0-9]{64}$/.test(sha)) throw new Error("SHA-256 需要 64 位十六进制");
    if (apkUrl && !/^https:\/\//.test(apkUrl)) throw new Error("安装包地址只接受 https");
    await sql.query(
      `insert into app_releases (id, channel, version_name, version_code, min_version_code, force_update, notes, apk_url, sha256, size_bytes, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set
         channel = excluded.channel,
         version_name = excluded.version_name,
         version_code = excluded.version_code,
         min_version_code = excluded.min_version_code,
         force_update = excluded.force_update,
         notes = excluded.notes,
         apk_url = excluded.apk_url,
         sha256 = excluded.sha256,
         size_bytes = excluded.size_bytes,
         active = excluded.active`,
      [
        releaseId,
        channel,
        versionName,
        versionCode,
        minVersionCode,
        Boolean(release.force),
        text(release.notes, 500),
        apkUrl,
        sha,
        Math.max(0, Math.floor(Number(release.sizeBytes ?? 0))),
        release.active !== false,
      ],
    );
    await audit(sql, userId, "release.save", releaseId, null, { versionName, versionCode, channel });
    return { ok: true, id: releaseId };
  }

  if (action === "ledger") {
    const rows = await sql.query<Row>(
      "select id, kind, delta, phase, ref, note, created_at from quota_ledger where user_id = $1 order by created_at desc limit 30",
      [userId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      delta: Number(row.delta),
      phase: String(row.phase),
      ref: String(row.ref ?? ""),
      note: String(row.note),
      createdAt: iso(row.created_at),
    }));
  }

  throw new Error("未知操作");
}

function orderCard(row: Row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    planId: String(row.plan_id),
    status: String(row.status),
    amountCents: Number(row.amount_cents),
    snapshot: asJson(row.snapshot),
    note: String(row.note ?? ""),
    createdAt: iso(row.created_at),
  };
}

function submissionCard(row: Row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    slug: String(row.slug),
    category: String(row.category),
    summary: String(row.summary),
    version: String(row.version),
    status: String(row.status),
    reviewNote: String(row.review_note ?? ""),
    checks: asJson(row.checks),
    createdAt: iso(row.created_at),
  };
}

async function publishSubmission(
  sql: Sql,
  _userId: string,
  draft: { name: string; slug: string; category: string; summary: string; version: string; schemaText: string },
) {
  const componentId = `cmp_${draft.slug}`.slice(0, 48);
  await sql.query(
    `insert into components (id, slug, name, category, summary, author_name, access, min_plan, status, latest_version)
     values ($1,$2,$3,$4,$5,'开发者','public_free','','published',$6)
     on conflict (slug) do nothing`,
    [componentId, draft.slug, draft.name, draft.category, draft.summary, draft.version],
  );
  const component = await one<{ id: string }>(sql, "select id from components where slug = $1", [draft.slug]);
  if (!component) return;
  await sql.query(
    "insert into component_versions (id, component_id, version, changelog) values ($1,$2,$3,$4) on conflict (component_id, version) do nothing",
    [id("ver"), component.id, draft.version, "投稿上架。只进入商城目录，不会变成新的 BlueOS 标签。"],
  );
}
