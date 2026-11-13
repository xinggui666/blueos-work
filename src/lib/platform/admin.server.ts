/**
 * 管理后台扩展接口（规格第十七章）：总览统计、用户详情、组件详情/版本/资源、卡密批次和兑换记录、
 * 订单详情、APP 版本灰度。权限全部在服务端检查（policy.allows），前端隐藏入口只是体验。
 */
import { createHash, randomBytes } from "node:crypto";
import { withTransaction, type Sql } from "@/lib/db";
import { ApiError, forbidden, notFound } from "./errors";
import { allows, isStaff } from "./policy";
import { loadOwnedDoc } from "./projects.server";
import { ASSET_MAX_BYTES, SEMVER, keysCsv, sniffImage } from "./admin-rules";

type Row = Record<string, unknown>;
export type AdminActor = { userId: string; roles: string[] };

export const ADMIN_EXTRA_ACTIONS = [
  "adminOverview",
  "adminUser",
  "adminUserProject",
  "adminRevokeComponent",
  "adminComponent",
  "adminSaveComponent",
  "adminAddComponentVersion",
  "adminSetComponentVersion",
  "adminUploadAsset",
  "adminDeleteAsset",
  "adminAsset",
  "adminKeyBatches",
  "adminKeys",
  "adminExportKeys",
  "adminKeyActivations",
  "adminOrder",
] as const;
export type AdminExtraAction = (typeof ADMIN_EXTRA_ACTIONS)[number];
export const isAdminExtraAction = (a: string): a is AdminExtraAction => (ADMIN_EXTRA_ACTIONS as readonly string[]).includes(a);

const newId = (prefix: string) => prefix + randomBytes(8).toString("hex");
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => Number(v ?? 0) || 0;
const asJson = (v: unknown) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
async function one<T extends Row>(sql: Sql, query: string, params: unknown[] = []): Promise<T | null> {
  return (await sql.query<T>(query, params))[0] ?? null;
}
function need(actor: AdminActor, perm: string) {
  if (!allows(actor.roles, perm)) throw forbidden();
}
async function audit(sql: Sql, actorId: string, action: string, target: string, before: unknown, after: unknown) {
  await sql.query("insert into audit_logs (id, actor_id, action, target, before, after) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)", [
    newId("a"),
    actorId,
    action,
    target,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
  ]);
}

export async function handleAdminExtra(sql: Sql, actor: AdminActor, action: AdminExtraAction, body: Record<string, unknown>, flags: Record<string, string>) {
  const me = actor.userId;

  if (action === "adminOverview") {
    if (!isStaff(actor.roles)) throw forbidden();
    const q = async (query: string) => num((await one<{ n: number }>(sql, query))?.n);
    const [users, active7, active30, projects, components, members, pending] = await Promise.all([
      q('select count(*)::int as n from "user"'),
      q("select count(distinct user_id)::int as n from client_devices where last_seen > now() - interval '7 days'"),
      q("select count(distinct user_id)::int as n from client_devices where last_seen > now() - interval '30 days'"),
      q("select count(*)::int as n from projects"),
      q("select count(*)::int as n from components where status = 'published'"),
      q("select count(distinct user_id)::int as n from memberships where ends_at > now()"),
      q("select count(*)::int as n from submissions where status = 'pending'"),
    ]);
    const spent = await sql.query<{ kind: string; n: number }>(
      "select kind, coalesce(sum(-delta), 0)::int as n from quota_ledger where phase = 'commit' and created_at > now() - interval '30 days' group by kind",
    );
    const orders = await sql.query<{ status: string; n: number; cents: number }>("select status, count(*)::int as n, coalesce(sum(amount_cents), 0)::bigint as cents from orders group by status");
    const builds = await sql.query<{ status: string; n: number }>("select status, count(*)::int as n from build_tasks group by status");
    const b = Object.fromEntries(builds.map((r) => [r.status, num(r.n)]));
    const finished = num(b.succeeded) + num(b.failed);
    const reasons = await sql.query<{ reason: string; n: number }>(
      "select left(error, 80) as reason, count(*)::int as n from build_tasks where status = 'failed' and error <> '' group by 1 order by 2 desc limit 5",
    );
    const storage = await one<Row>(
      sql,
      `select
         (select coalesce(sum(pg_column_size(body)), 0) from projects)::bigint as projects,
         (select coalesce(sum(octet_length(snapshot)), 0) from project_revisions)::bigint as revisions,
         (select coalesce(sum(coalesce(artifact_bytes, 0) + coalesce(octet_length(source_zip), 0)), 0) from build_tasks)::bigint as builds,
         (select coalesce(sum(bytes), 0) from component_assets)::bigint as assets,
         pg_database_size(current_database())::bigint as database`,
    );
    const workers = await q("select count(*)::int as n from build_workers where seen_at > now() - interval '60 seconds'");
    return {
      users,
      activeUsers7d: active7,
      activeUsers30d: active30,
      projects,
      components,
      members,
      pending,
      spent30d: Object.fromEntries(spent.map((r) => [r.kind, num(r.n)])),
      orders: Object.fromEntries(orders.map((r) => [r.status, { count: num(r.n), amountCents: num(r.cents) }])),
      builds: { counts: b, successRate: finished ? Math.round((num(b.succeeded) / finished) * 1000) / 10 : null, workersOnline: workers },
      failureReasons: reasons.map((r) => ({ reason: String(r.reason), count: num(r.n) })),
      storage: {
        projectsBytes: num(storage?.projects),
        revisionsBytes: num(storage?.revisions),
        buildsBytes: num(storage?.builds),
        assetsBytes: num(storage?.assets),
        databaseBytes: num(storage?.database),
      },
      flags,
      note: "成功率 = 成功 /（成功 + 失败）；不可用和取消不计入。活跃用户按客户端最近访问记录统计。",
    };
  }

  if (action === "adminUser") {
    need(actor, "users.read");
    const target = text(body.userId, 80);
    const user = await one<Row>(sql, 'select id, email, name, "createdAt" as created_at from "user" where id = $1', [target]);
    if (!user) throw notFound("用户不存在");
    const profile = await one<Row>(sql, "select status, developer_status from profiles where user_id = $1", [target]);
    const roles = (await sql.query<{ role: string }>("select role from user_roles where user_id = $1", [target])).map((r) => r.role);
    const quota = await sql.query<Row>("select kind, balance, reserved from quota_accounts where user_id = $1", [target]);
    const membership = await one<Row>(sql, "select plan_id, ends_at, snapshot from memberships where user_id = $1 and ends_at > now() order by ends_at desc limit 1", [target]);
    const projects = await sql.query<Row>(
      "select id, name, package_name, device, schema_version, revision, pg_column_size(body)::int as bytes, updated_at from projects where user_id = $1 order by updated_at desc limit 50",
      [target],
    );
    const builds = await sql.query<Row>("select id, project_id, status, quota_state, error, created_at from build_tasks where user_id = $1 order by created_at desc limit 15", [target]);
    const jobs = await sql.query<Row>("select id, kind, status, message, created_at from jobs where user_id = $1 order by created_at desc limit 10", [target]);
    const ledger = await sql.query<Row>("select kind, delta, phase, ref, note, created_at from quota_ledger where user_id = $1 order by created_at desc limit 30", [target]);
    const grants = await sql.query<Row>(
      "select g.component_id, c.name, g.source, g.expires_at from component_grants g join components c on c.id = g.component_id where g.user_id = $1 order by c.name",
      [target],
    );
    const devices = await sql.query<Row>("select client, last_seen from client_devices where user_id = $1 order by last_seen desc limit 10", [target]);
    const logs = await sql.query<Row>(
      "select action, actor_id, target, after, created_at from audit_logs where target = $1 or actor_id = $1 order by created_at desc limit 30",
      [target],
    );
    return {
      id: String(user.id),
      email: String(user.email),
      name: String(user.name),
      createdAt: iso(user.created_at),
      status: profile ? String(profile.status) : "active",
      developerStatus: profile ? String(profile.developer_status) : "none",
      roles,
      quota: Object.fromEntries(quota.map((r) => [String(r.kind), { balance: num(r.balance), reserved: num(r.reserved) }])),
      membership: membership ? { planId: String(membership.plan_id), endsAt: iso(membership.ends_at), snapshot: asJson(membership.snapshot) } : null,
      projects: projects.length,
      projectList: projects.map((p) => ({
        id: String(p.id),
        name: String(p.name),
        packageName: String(p.package_name),
        device: String(p.device),
        schemaVersion: num(p.schema_version),
        revision: num(p.revision),
        bytes: num(p.bytes),
        updatedAt: iso(p.updated_at),
      })),
      builds: builds.map((r) => ({ id: String(r.id), projectId: String(r.project_id), status: String(r.status), quotaState: String(r.quota_state), error: String(r.error ?? ""), createdAt: iso(r.created_at) })),
      jobs: jobs.map((r) => ({ id: String(r.id), kind: String(r.kind), status: String(r.status), message: String(r.message), createdAt: iso(r.created_at) })),
      ledger: ledger.map((r) => ({ kind: String(r.kind), delta: num(r.delta), phase: String(r.phase), ref: String(r.ref ?? ""), note: String(r.note), createdAt: iso(r.created_at) })),
      grants: grants.map((r) => ({ componentId: String(r.component_id), name: String(r.name), source: String(r.source), expiresAt: iso(r.expires_at) })),
      devices: devices.map((r) => ({ client: String(r.client), lastSeen: iso(r.last_seen) })),
      logs: logs.map((r) => ({ action: String(r.action), actorId: String(r.actor_id), target: String(r.target), after: asJson(r.after), createdAt: iso(r.created_at) })),
    };
  }

  if (action === "adminUserProject") {
    need(actor, "users.read");
    const target = text(body.userId, 80);
    const projectId = text(body.projectId, 48);
    // 只读查看；查看本身写审计，方便追查谁看过用户工程。
    const loaded = await loadOwnedDoc(sql, target, projectId);
    await audit(sql, me, "project.view", projectId, null, { userId: target, revision: loaded.revision });
    return loaded;
  }

  if (action === "adminRevokeComponent") {
    need(actor, "users.membership");
    const target = text(body.userId, 80);
    const componentId = text(body.componentId, 48);
    const removed = await sql.query("delete from component_grants where user_id = $1 and component_id = $2 returning source", [target, componentId]);
    if (!removed.length) throw notFound("没有这条组件授权");
    await audit(sql, me, "component.revoke", target, removed[0], { componentId });
    return { ok: true };
  }

  if (action === "adminComponent") {
    need(actor, "components.write");
    const componentId = text(body.id, 48);
    const c = await one<Row>(sql, "select * from components where id = $1", [componentId]);
    if (!c) throw notFound("组件不存在");
    const versions = await sql.query<Row>("select id, version, changelog, sdk_min, active, created_at from component_versions where component_id = $1 order by created_at desc", [componentId]);
    const assets = await sql.query<Row>("select id, name, mime, bytes, sha256, created_at from component_assets where component_id = $1 order by created_at desc", [componentId]);
    const usage = await one<{ n: number }>(sql, "select count(*)::int as n from component_installs where component_id = $1", [componentId]);
    return {
      id: String(c.id),
      slug: String(c.slug),
      name: String(c.name),
      category: String(c.category),
      summary: String(c.summary),
      description: String(c.description ?? ""),
      access: String(c.access),
      minPlan: String(c.min_plan ?? ""),
      status: String(c.status),
      latestVersion: String(c.latest_version),
      sdkMin: String(c.sdk_min ?? ""),
      sdkMax: String(c.sdk_max ?? ""),
      dependencies: (asJson(c.dependencies) as string[]) ?? [],
      installs: num(usage?.n),
      versions: versions.map((v) => ({ id: String(v.id), version: String(v.version), changelog: String(v.changelog), sdkMin: String(v.sdk_min ?? ""), active: Boolean(v.active), createdAt: iso(v.created_at) })),
      assets: assets.map((a) => ({ id: String(a.id), name: String(a.name), mime: String(a.mime), bytes: num(a.bytes), sha256: String(a.sha256), createdAt: iso(a.created_at) })),
    };
  }

  if (action === "adminSaveComponent") {
    need(actor, "components.write");
    const componentId = text(body.id, 48);
    const before = await one<Row>(sql, "select name, summary, description, category, access, status, min_plan, sdk_min, sdk_max, dependencies from components where id = $1", [componentId]);
    if (!before) throw notFound("组件不存在");
    const access = text(body.access, 40) || String(before.access);
    if (!["public_free", "membership", "license_key", "specific_user", "internal", "disabled"].includes(access)) throw new ApiError(400, "授权类型无效");
    const status = body.status === undefined ? String(before.status) : body.status === "unpublished" ? "unpublished" : "published";
    const sdkMin = text(body.sdkMin, 20);
    const sdkMax = text(body.sdkMax, 20);
    for (const v of [sdkMin, sdkMax]) if (v && !/^\d+(\.\d+){0,2}$/.test(v)) throw new ApiError(400, "SDK 版本格式应为 数字(.数字)");
    const deps = Array.isArray(body.dependencies) ? body.dependencies.map((d) => text(d, 40)).filter(Boolean).slice(0, 20) : (asJson(before.dependencies) as string[]);
    if (deps.length) {
      const own = await one<{ slug: string }>(sql, "select slug from components where id = $1", [componentId]);
      if (own && deps.includes(own.slug)) throw new ApiError(400, "组件不能依赖自己");
      const found = await sql.query<{ slug: string }>("select slug from components where slug = any($1::text[])", [deps]);
      const missing = deps.filter((d) => !found.some((f) => f.slug === d));
      if (missing.length) throw new ApiError(400, `依赖的组件不存在：${missing.join(", ")}`);
    }
    const next = {
      name: text(body.name, 40) || String(before.name),
      summary: body.summary === undefined ? String(before.summary) : text(body.summary, 400),
      description: body.description === undefined ? String(before.description ?? "") : text(body.description, 4000),
      category: text(body.category, 20) || String(before.category),
      minPlan: body.minPlan === undefined ? String(before.min_plan ?? "") : text(body.minPlan, 40),
      access,
      status,
      sdkMin,
      sdkMax,
      dependencies: deps,
    };
    await sql.query(
      `update components set name = $2, summary = $3, description = $4, category = $5, min_plan = $6, access = $7, status = $8, sdk_min = $9, sdk_max = $10, dependencies = $11::jsonb where id = $1`,
      [componentId, next.name, next.summary, next.description, next.category, next.minPlan, next.access, next.status, next.sdkMin, next.sdkMax, JSON.stringify(next.dependencies)],
    );
    await audit(sql, me, "component.update", componentId, before, next);
    return { ok: true };
  }

  if (action === "adminAddComponentVersion") {
    need(actor, "components.write");
    const componentId = text(body.id, 48);
    const version = text(body.version, 20);
    if (!SEMVER.test(version)) throw new ApiError(400, "版本号格式应为 x.y.z");
    const c = await one<Row>(sql, "select latest_version from components where id = $1", [componentId]);
    if (!c) throw notFound("组件不存在");
    const newer = (a: string, b: string) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
      return false;
    };
    if (!newer(version, String(c.latest_version))) throw new ApiError(400, `新版本号必须大于当前 ${String(c.latest_version)}`);
    await withTransaction(async (tx) => {
      await tx.query("insert into component_versions (id, component_id, version, changelog, sdk_min) values ($1,$2,$3,$4,$5)", [
        newId("ver"),
        componentId,
        version,
        text(body.changelog, 1000),
        text(body.sdkMin, 20),
      ]);
      await tx.query("update components set latest_version = $2 where id = $1", [componentId, version]);
      await audit(tx, me, "component.version", componentId, { latest: c.latest_version }, { latest: version });
    });
    return { ok: true };
  }

  if (action === "adminSetComponentVersion") {
    need(actor, "components.write");
    const versionId = text(body.versionId, 48);
    const active = body.active !== false;
    const v = await one<Row>(sql, "select component_id, version from component_versions where id = $1", [versionId]);
    if (!v) throw notFound("版本不存在");
    const c = await one<Row>(sql, "select latest_version from components where id = $1", [v.component_id]);
    if (!active && String(c?.latest_version) === String(v.version)) throw new ApiError(400, "不能停用当前最新版本，请先发布新版本");
    await sql.query("update component_versions set active = $2 where id = $1", [versionId, active]);
    await audit(sql, me, "component.version.active", String(v.component_id), null, { version: v.version, active });
    return { ok: true };
  }

  if (action === "adminUploadAsset") {
    need(actor, "components.write");
    const componentId = text(body.id, 48);
    if (!(await one(sql, "select id from components where id = $1", [componentId]))) throw notFound("组件不存在");
    const b64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
    if (!b64 || b64.length > Math.ceil((ASSET_MAX_BYTES * 4) / 3) + 8) throw new ApiError(413, "资源为空或超过 256 KB");
    const data = Buffer.from(b64, "base64");
    if (!data.length || data.length > ASSET_MAX_BYTES) throw new ApiError(413, "资源为空或超过 256 KB");
    const mime = sniffImage(data);
    if (!mime) throw new ApiError(400, "只接受 PNG、JPEG、WebP 图片");
    const name = text(body.name, 80).replace(/[^\w.\-\u4e00-\u9fa5]/g, "_") || "asset";
    const count = await one<{ n: number }>(sql, "select count(*)::int as n from component_assets where component_id = $1", [componentId]);
    if (num(count?.n) >= 20) throw new ApiError(400, "每个组件最多 20 个资源");
    const sha = createHash("sha256").update(data).digest("hex");
    const assetId = newId("as");
    await sql.query("insert into component_assets (id, component_id, name, mime, bytes, sha256, data, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)", [
      assetId,
      componentId,
      name,
      mime,
      data.length,
      sha,
      data,
      me,
    ]);
    await audit(sql, me, "component.asset.upload", componentId, null, { assetId, name, mime, bytes: data.length, sha256: sha });
    return { id: assetId, mime, bytes: data.length, sha256: sha };
  }

  if (action === "adminDeleteAsset") {
    need(actor, "components.write");
    const assetId = text(body.assetId, 48);
    const removed = await sql.query<Row>("delete from component_assets where id = $1 returning component_id, name, sha256", [assetId]);
    if (!removed.length) throw notFound("资源不存在");
    await audit(sql, me, "component.asset.delete", String(removed[0].component_id), removed[0], null);
    return { ok: true };
  }

  if (action === "adminAsset") {
    need(actor, "components.write");
    const a = await one<Row>(sql, "select name, mime, bytes, sha256, data from component_assets where id = $1", [text(body.assetId, 48)]);
    if (!a) throw notFound("资源不存在");
    return { name: String(a.name), mime: String(a.mime), bytes: num(a.bytes), sha256: String(a.sha256), dataBase64: Buffer.from(a.data as Uint8Array).toString("base64") };
  }

  if (action === "adminKeyBatches") {
    need(actor, "keys.write");
    const rows = await sql.query<Row>(
      `select b.id, b.type, b.title, b.quantity, b.created_at, b.payload,
         count(k.id) filter (where k.status = 'unused')::int as unused,
         count(k.id) filter (where k.status = 'used')::int as used,
         count(k.id) filter (where k.status in ('void','frozen'))::int as voided,
         count(k.id) filter (where k.status = 'unused' and k.expires_at < now())::int as expired,
         min(k.expires_at) as expires_at
       from license_batches b left join license_keys k on k.batch_id = b.id
       group by b.id order by b.created_at desc limit 50`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      title: String(r.title),
      quantity: num(r.quantity),
      payload: asJson(r.payload),
      unused: num(r.unused),
      used: num(r.used),
      voided: num(r.voided),
      expired: num(r.expired),
      expiresAt: iso(r.expires_at),
      createdAt: iso(r.created_at),
    }));
  }

  if (action === "adminKeys" || action === "adminExportKeys") {
    need(actor, "keys.write");
    const batchId = text(body.batchId, 48);
    const status = text(body.status, 20);
    if (action === "adminExportKeys" && !batchId) throw new ApiError(400, "请选择要导出的批次");
    const rows = await sql.query<Row>(
      `select k.id, k.hint, k.type, k.status, k.expires_at, k.used_at, k.used_by, u.email as used_email, b.title, b.id as batch_id
       from license_keys k join license_batches b on b.id = k.batch_id left join "user" u on u.id = k.used_by
       where ($1 = '' or k.batch_id = $1) and ($2 = '' or k.status = $2)
       order by k.used_at desc nulls last, k.id desc limit $3`,
      [batchId, status, action === "adminExportKeys" ? 5000 : 100],
    );
    const list = rows.map((r) => ({
      id: String(r.id),
      batchId: String(r.batch_id),
      hint: String(r.hint),
      type: String(r.type),
      status: r.status === "unused" && r.expires_at && new Date(r.expires_at as string).getTime() < Date.now() ? "expired" : String(r.status),
      title: String(r.title),
      expiresAt: iso(r.expires_at),
      usedAt: iso(r.used_at),
      usedBy: r.used_email ? String(r.used_email) : r.used_by ? String(r.used_by) : "",
    }));
    if (action === "adminKeys") return list;
    await audit(sql, me, "keys.export", batchId, null, { rows: list.length });
    return { fileName: `keys-${batchId}.csv`, csv: keysCsv(list), rows: list.length, note: "清单只含掩码提示，不含明文卡密。" };
  }

  if (action === "adminKeyActivations") {
    need(actor, "keys.write");
    const rows = await sql.query<Row>(
      `select a.id, a.key_id, a.user_id, a.result, a.created_at, k.hint, u.email
       from license_activations a left join license_keys k on k.id = a.key_id left join "user" u on u.id = a.user_id
       order by a.created_at desc limit 100`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      keyId: String(r.key_id),
      hint: r.hint ? String(r.hint) : "（不存在的卡密）",
      userId: String(r.user_id),
      email: String(r.email ?? ""),
      result: String(r.result),
      createdAt: iso(r.created_at),
    }));
  }

  // adminOrder：订单详情 + 权益发放记录（会员段、积分流水、审计）。
  need(actor, "orders.confirm");
  const orderId = text(body.id, 48);
  const order = await one<Row>(sql, 'select o.*, u.email from orders o left join "user" u on u.id = o.user_id where o.id = $1', [orderId]);
  if (!order) throw notFound("订单不存在");
  const memberships = await sql.query<Row>("select plan_id, starts_at, ends_at, source from memberships where source = $1 order by starts_at", [`order:${orderId}`]);
  const ledger = await sql.query<Row>("select kind, delta, phase, ref, note, created_at from quota_ledger where ref = any($1::text[]) order by created_at", [[`order:${orderId}`, `refund:${orderId}`]]);
  const logs = await sql.query<Row>("select action, actor_id, before, after, created_at from audit_logs where target = $1 order by created_at", [orderId]);
  return {
    id: String(order.id),
    userId: String(order.user_id),
    email: String(order.email ?? ""),
    planId: String(order.plan_id),
    status: String(order.status),
    amountCents: num(order.amount_cents),
    snapshot: asJson(order.snapshot),
    note: String(order.note ?? ""),
    createdAt: iso(order.created_at),
    memberships: memberships.map((m) => ({ planId: String(m.plan_id), startsAt: iso(m.starts_at), endsAt: iso(m.ends_at) })),
    ledger: ledger.map((l) => ({ kind: String(l.kind), delta: num(l.delta), phase: String(l.phase), ref: String(l.ref), note: String(l.note), createdAt: iso(l.created_at) })),
    logs: logs.map((l) => ({ action: String(l.action), actorId: String(l.actor_id), before: asJson(l.before), after: asJson(l.after), createdAt: iso(l.created_at) })),
  };
}
