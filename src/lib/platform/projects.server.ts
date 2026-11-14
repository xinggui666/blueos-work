import { loadAssets } from "./assets.server";
/**
 * 工程存储（统一协议 v2）。
 * - projects.body 保存协议文档；旧的编辑器格式在读取时自动迁移（旧工程永远能打开）。
 * - 内容变化才形成新的服务端修订（project_revisions.source='save'，带完整 doc 和摘要），修订不可变。
 * - 冲突：客户端带 baseRevision 保存，服务端已有更新修订且内容不同 → 冲突，返回服务端版本，双方都保留。
 */
import type { Sql } from "@/lib/db";
import type { Project, Revision } from "@/lib/blueos/model";
import { contentDigest } from "@/lib/protocol/bproj";
import { docToProject, projectToDoc, type EditorProject } from "@/lib/protocol/editor";
import { detectVersion, migrateToCurrent } from "@/lib/protocol/migrate";
import { ProjectDocSchema, SCHEMA_VERSION, type ProjectDoc } from "@/lib/protocol/schema";
import { semanticIssues, type ProtocolIssue } from "@/lib/protocol/validate";
import { ApiError, forbidden, notFound } from "./errors";

type Row = Record<string, unknown>;

export const MAX_DOC_BYTES = 400_000;

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
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/** 数据库行 → 协议文档（必要时迁移）。迁移失败返回 null 和原因，不抛异常。 */
export function docFromRow(row: Row): {
  doc: ProjectDoc | null;
  migratedFrom: string | null;
  issues: ProtocolIssue[];
} {
  const body = asJson(row.body);
  const version = detectVersion(body);
  if (version === 2) {
    const parsed = ProjectDocSchema.safeParse(body);
    if (parsed.success) {
      const doc = parsed.data;
      doc.project.revision = Number(row.revision ?? doc.project.revision) || 0;
      return { doc, migratedFrom: null, issues: [] };
    }
    return {
      doc: null,
      migratedFrom: null,
      issues: parsed.error.issues
        .slice(0, 10)
        .map((i) => ({ path: i.path.join("."), message: i.message, level: "error" as const })),
    };
  }
  const res = migrateToCurrent(body);
  if (res.doc) {
    res.doc.project.revision = Number(row.revision ?? 0) || 0;
    res.doc.project.updatedAt = stamp(row.updated_at);
  }
  return { doc: res.doc, migratedFrom: String(res.from), issues: res.issues };
}

/** 结构校验（保存必须通过）；语义问题随结果返回，草稿允许暂时有语义错误，构建前必须全部通过。 */
export function checkForSave(input: unknown): { doc: ProjectDoc; issues: ProtocolIssue[] } {
  if (JSON.stringify(input ?? null).length > MAX_DOC_BYTES) throw new ApiError(413, "工程过大");
  const version = detectVersion(input);
  if (version === "future") throw new ApiError(400, "工程来自更新版本的客户端，服务端暂不支持");
  let candidate = input;
  if (version === "v1-editor" || version === "v1-dsl") {
    const migrated = migrateToCurrent(input);
    if (!migrated.doc) throw new ApiError(400, migrated.issues[0]?.message ?? "工程格式无效");
    candidate = migrated.doc;
  }
  const parsed = ProjectDocSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(
      400,
      `工程结构无效：${first?.path.join(".") || "(根)"} ${first?.message ?? ""}`.trim(),
    );
  }
  return { doc: parsed.data, issues: semanticIssues(parsed.data) };
}

export type SaveResult =
  | { ok: true; revision: number; changed: boolean; contentSha256: string; issues: ProtocolIssue[] }
  | { ok: false; conflict: true; serverRevision: number; serverDoc: ProjectDoc; message: string };

/**
 * 保存协议文档。调用方负责事务。
 * baseRevision=undefined 表示旧客户端（不做冲突检查，保持兼容）。
 */
export async function saveDoc(
  sql: Sql,
  userId: string,
  doc: ProjectDoc,
  opts: { baseRevision?: number; projectCap: () => Promise<number>; client: string },
): Promise<SaveResult> {
  const current = (
    await sql.query<Row>(
      "select id, user_id, revision, content_sha256, body, updated_at from projects where id = $1 for update",
      [doc.project.id],
    )
  )[0];
  if (current && current.user_id !== userId) throw forbidden("这个工程不属于当前账号");
  if (!current) {
    const count = (
      await sql.query<{ count: number }>(
        "select count(*)::int as count from projects where user_id = $1",
        [userId],
      )
    )[0];
    const cap = await opts.projectCap();
    if ((count?.count ?? 0) >= cap)
      throw new ApiError(403, `当前权益最多保存 ${cap} 个工程。编辑已有工程不受影响。`);
  }
  await loadAssets(sql, userId, doc);
  const digest = await contentDigest(doc);
  const serverRevision = Number(current?.revision ?? 0);
  if (current && current.content_sha256 === digest) {
    return {
      ok: true,
      revision: serverRevision,
      changed: false,
      contentSha256: digest,
      issues: semanticIssues(doc),
    };
  }
  if (current && opts.baseRevision !== undefined && opts.baseRevision < serverRevision) {
    const server = docFromRow(current);
    if (server.doc) {
      const serverDigest = await contentDigest(server.doc);
      if (serverDigest !== digest) {
        return {
          ok: false,
          conflict: true,
          serverRevision,
          serverDoc: server.doc,
          message: "云端有更新的版本（可能来自其他设备），已保留双方版本",
        };
      }
    }
  }
  const nextRev =
    Number(
      (
        await sql.query<{ rev: number }>(
          "select coalesce(max(rev), 0)::int as rev from project_revisions where project_id = $1",
          [doc.project.id],
        )
      )[0]?.rev ?? 0,
    ) + 1;
  const revision = Math.max(nextRev, serverRevision + 1);
  const now = Date.now();
  const stored: ProjectDoc = {
    ...doc,
    project: { ...doc.project, revision, updatedAt: now, createdAt: doc.project.createdAt || now },
  };
  const body = JSON.stringify(stored);
  await sql.query(
    `insert into projects (id, user_id, name, app_name, package_name, device, body, updated_at, schema_version, revision, content_sha256)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb, now(), $8, $9, $10)
     on conflict (id) do update set
       name = excluded.name, app_name = excluded.app_name, package_name = excluded.package_name, device = excluded.device,
       body = excluded.body, updated_at = now(), schema_version = excluded.schema_version, revision = excluded.revision, content_sha256 = excluded.content_sha256
     where projects.user_id = excluded.user_id`,
    [
      doc.project.id,
      userId,
      doc.project.name,
      doc.project.appName,
      doc.project.packageName,
      doc.manifest.device,
      body,
      SCHEMA_VERSION,
      revision,
      digest,
    ],
  );
  await sql.query(
    `insert into project_revisions (id, project_id, user_id, rev, note, snapshot, doc, schema_version, content_sha256, source, client)
     values ($1,$2,$3,$4,$5,'',$6::jsonb,$7,$8,'save',$9)`,
    [
      `r${doc.project.id.slice(0, 20)}${revision}x${now.toString(36)}`.slice(0, 48),
      doc.project.id,
      userId,
      revision,
      "保存",
      body,
      SCHEMA_VERSION,
      digest,
      opts.client,
    ],
  );
  return {
    ok: true,
    revision,
    changed: true,
    contentSha256: digest,
    issues: semanticIssues(stored),
  };
}

export async function loadOwnedDoc(
  sql: Sql,
  userId: string,
  projectId: string,
  revision?: number,
): Promise<{
  doc: ProjectDoc;
  revision: number;
  contentSha256: string;
  issues: ProtocolIssue[];
  migratedFrom: string | null;
}> {
  if (revision !== undefined) {
    const row = (
      await sql.query<Row>(
        "select r.doc, r.rev, r.content_sha256 from project_revisions r join projects p on p.id = r.project_id where r.project_id = $1 and p.user_id = $2 and r.rev = $3 and r.doc is not null",
        [projectId, userId, revision],
      )
    )[0];
    if (!row) throw notFound("没有这个修订");
    const res = docFromRow({ body: row.doc, revision: row.rev });
    if (!res.doc) throw new ApiError(400, "修订数据无法读取");
    return {
      doc: res.doc,
      revision: Number(row.rev),
      contentSha256: String(row.content_sha256 ?? (await contentDigest(res.doc))),
      issues: semanticIssues(res.doc),
      migratedFrom: res.migratedFrom,
    };
  }
  const row = (
    await sql.query<Row>(
      "select id, body, revision, content_sha256, updated_at from projects where id = $1 and user_id = $2",
      [projectId, userId],
    )
  )[0];
  if (!row) throw notFound("工程不存在");
  const res = docFromRow(row);
  if (!res.doc)
    throw new ApiError(400, `工程数据无法读取：${res.issues[0]?.message ?? "未知错误"}`);
  return {
    doc: res.doc,
    revision: Number(row.revision ?? 0),
    contentSha256: await contentDigest(res.doc),
    issues: semanticIssues(res.doc),
    migratedFrom: res.migratedFrom,
  };
}

/** 编辑器格式（网页工坊当前使用）。 */
export function editorProjectFrom(row: Row, revisions: Revision[]): Project | null {
  const res = docFromRow(row);
  if (!res.doc) return null;
  const project = docToProject(res.doc, revisions);
  project.updatedAt = stamp(row.updated_at);
  return project;
}

export function editorToDoc(project: EditorProject): ProjectDoc {
  return projectToDoc(project);
}

export async function listRevisions(sql: Sql, userId: string, projectId: string) {
  const owned = (
    await sql.query<Row>("select id from projects where id = $1 and user_id = $2", [
      projectId,
      userId,
    ])
  )[0];
  if (!owned) throw notFound("工程不存在");
  const rows = await sql.query<Row>(
    "select rev, note, source, client, content_sha256, schema_version, created_at, (doc is not null) as has_doc from project_revisions where project_id = $1 order by rev desc limit 100",
    [projectId],
  );
  return rows.map((r) => ({
    revision: Number(r.rev),
    note: String(r.note ?? ""),
    source: String(r.source ?? "client"),
    client: r.client ? String(r.client) : null,
    contentSha256: r.content_sha256 ? String(r.content_sha256) : null,
    schemaVersion: r.schema_version ? Number(r.schema_version) : null,
    restorable: Boolean(r.has_doc),
    createdAt: new Date(stamp(r.created_at)).toISOString(),
  }));
}
