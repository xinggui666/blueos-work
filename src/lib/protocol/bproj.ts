/**
 * .bproj 工程包 v2（规格 4.4）：project.json（统一协议）+ manifest.json（完整性信息）+ README.txt。
 * 不包含生成器、服务端源码或商业组件实现；不是 RPK。
 * 导入：完整性校验 → 版本识别与迁移 → Schema/语义校验 → 依赖与资源检查 → 预览信息。
 */
import { migrateToCurrent, type DetectedVersion } from "./migrate.ts";
import { PROTOCOL_FORMAT, SCHEMA_VERSION, type ProjectDoc } from "./schema.ts";
import type { ProtocolIssue } from "./validate.ts";
import { readZip, writeZip, type Inflate } from "./zip.ts";

export const BPROJ_VERSION = 2;

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 键排序的稳定 JSON，用于内容摘要。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 工程内容摘要：忽略保存时间和修订号，内容相同摘要就相同（用于幂等和重复导入判断）。 */
export function contentDigest(doc: ProjectDoc): Promise<string> {
  return sha256Hex(
    canonicalJson({ ...doc, project: { ...doc.project, updatedAt: 0, revision: 0, createdAt: 0 } }),
  );
}

export type BprojManifest = {
  format: "bproj";
  version: number;
  schemaVersion: number;
  projectFormat: typeof PROTOCOL_FORMAT;
  projectId: string;
  revision: number;
  contentSha256: string;
  files: Record<string, { sha256: string; bytes: number }>;
  dependencies: ProjectDoc["dependencies"];
  generator: string;
  exportedAt: number;
  officialBuild: false;
};

const README =
  "这是蓝河工坊的项目工程包（.bproj），用于备份、转移和再次导入继续编辑。\n它不是源码、不是安装包，也不是 RPK；不包含平台生成器、服务端源码和商业组件实现。\n";

export async function packBproj(
  doc: ProjectDoc,
  exportedAt = Date.now(),
): Promise<{ bytes: Uint8Array; manifest: BprojManifest; sha256: string }> {
  const enc = new TextEncoder();
  const projectBytes = enc.encode(JSON.stringify(doc, null, 2));
  const readmeBytes = enc.encode(README);
  const manifest: BprojManifest = {
    format: "bproj",
    version: BPROJ_VERSION,
    schemaVersion: SCHEMA_VERSION,
    projectFormat: PROTOCOL_FORMAT,
    projectId: doc.project.id,
    revision: doc.project.revision,
    contentSha256: await contentDigest(doc),
    files: {
      "project.json": { sha256: await sha256Hex(projectBytes), bytes: projectBytes.length },
      "README.txt": { sha256: await sha256Hex(readmeBytes), bytes: readmeBytes.length },
    },
    dependencies: doc.dependencies,
    generator: "blueos-workshop",
    exportedAt,
    officialBuild: false,
  };
  const bytes = writeZip([
    { path: "manifest.json", data: enc.encode(JSON.stringify(manifest, null, 2)) },
    { path: "project.json", data: projectBytes },
    { path: "README.txt", data: readmeBytes },
  ]);
  return { bytes, manifest, sha256: await sha256Hex(bytes) };
}

export type ImportPreview = {
  ok: boolean;
  doc: ProjectDoc | null;
  from: DetectedVersion | "invalid";
  steps: string[];
  integrity: "verified" | "legacy" | "failed";
  contentSha256: string | null;
  issues: ProtocolIssue[];
  summary: {
    name: string;
    appName: string;
    packageName: string;
    device: string;
    pages: number;
    components: number;
    variables: number;
    events: number;
    functions: number;
    assets: number;
    dependencies: string[];
  } | null;
};

/** 读取并校验 .bproj，返回导入预览；不修改任何已有工程（导入失败不破坏当前工程）。 */
export async function inspectBproj(bytes: Uint8Array, inflate?: Inflate): Promise<ImportPreview> {
  const fail = (
    message: string,
    integrity: ImportPreview["integrity"] = "failed",
  ): ImportPreview => ({
    ok: false,
    doc: null,
    from: "invalid",
    steps: [],
    integrity,
    contentSha256: null,
    issues: [{ path: "", level: "error", message }],
    summary: null,
  });
  let files: Record<string, Uint8Array>;
  try {
    files = await readZip(bytes, inflate);
  } catch (error) {
    return fail(`工程包无法读取：${(error as Error).message}`);
  }
  const projectBytes = files["project.json"];
  if (!projectBytes) return fail("工程包里没有 project.json");
  const dec = new TextDecoder();
  let manifest: Partial<BprojManifest> | null = null;
  if (files["manifest.json"]) {
    try {
      manifest = JSON.parse(dec.decode(files["manifest.json"])) as Partial<BprojManifest>;
    } catch {
      return fail("manifest.json 不是有效的 JSON");
    }
  }
  const issues: ProtocolIssue[] = [];
  let integrity: ImportPreview["integrity"] = "legacy";
  if (manifest && Number(manifest.version) >= 2) {
    for (const [name, info] of Object.entries(manifest.files ?? {})) {
      const data = files[name];
      if (!data) return fail(`清单里的文件 ${name} 缺失`);
      if ((await sha256Hex(data)) !== info.sha256 || data.length !== info.bytes)
        return fail(`文件 ${name} 校验失败，工程包可能被修改或损坏`);
    }
    if (!manifest.files?.["project.json"]) return fail("清单没有记录 project.json 的校验值");
    integrity = "verified";
  } else {
    issues.push({
      path: "manifest.json",
      level: "warn",
      message: "旧版工程包没有文件校验信息，已按旧格式导入",
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(dec.decode(projectBytes));
  } catch {
    return fail("project.json 不是有效的 JSON");
  }
  const migrated = migrateToCurrent(raw);
  issues.push(...migrated.issues);
  let contentSha256: string | null = null;
  if (migrated.doc) {
    contentSha256 = await contentDigest(migrated.doc);
    if (
      integrity === "verified" &&
      manifest?.contentSha256 &&
      manifest.contentSha256 !== contentSha256
    ) {
      return { ...fail("工程内容摘要与清单不一致，拒绝导入"), from: migrated.from };
    }
  }
  const doc = migrated.doc;
  return {
    ok: migrated.ok,
    doc,
    from: migrated.from,
    steps: migrated.steps,
    integrity,
    contentSha256,
    issues,
    summary: doc
      ? {
          name: doc.project.name,
          appName: doc.project.appName,
          packageName: doc.project.packageName,
          device: doc.manifest.device,
          pages: doc.pages.length,
          components: doc.pages.reduce((s, p) => s + p.components.length, 0),
          variables: doc.variables.length,
          events: doc.events.length,
          functions: doc.functions.length,
          assets: doc.assets.length,
          dependencies: doc.dependencies.map((d) => `${d.type}@${d.version}`),
        }
      : null,
  };
}
