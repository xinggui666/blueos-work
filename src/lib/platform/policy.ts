export const ROLES = ["reviewer", "operator", "admin", "super_admin"] as const;
export type RoleName = (typeof ROLES)[number];

export const CONFIG_KEYS = [
  "registration_open",
  "marketplace_open",
  "submissions_open",
  "auto_publish",
  "generation_enabled",
  "build_enabled",
  "membership_open",
  "keys_open",
  "export_enabled",
  "announcements_enabled",
  "maintenance_mode",
] as const;

/** 维护模式下普通用户仍可用的只读接口（管理员不受维护模式限制）。 */
export const MAINTENANCE_READ_ACTIONS = [
  "me",
  "listProjects",
  "getProjectDoc",
  "listRevisions",
  "validateProject",
  "previewImport",
  "getAsset",
  "assetUsage",
  "listJobs",
  "downloadJob",
  "listBuilds",
  "getBuild",
  "downloadBuild",
  "market",
  "listOrders",
  "mySubmissions",
  "ledger",
  "releaseCheck",
] as const;

export const STARTER_QUOTA = { generation: 0, build: 0, export: 0 } as const;
export const FREE_PROJECT_LIMIT = 3;
export type QuotaKind = "generation" | "build" | "export";
export const QUOTA_KINDS: QuotaKind[] = ["generation", "build", "export"];

export const OFFICIAL_ACCESS: Record<string, "public_free" | "membership" | "license_key"> = {
  text: "public_free",
  image: "public_free",
  button: "public_free",
  column: "public_free",
  row: "public_free",
  spacer: "public_free",
  divider: "public_free",
  rect: "public_free",
  circle: "public_free",
  progress: "public_free",
  switch: "public_free",
  number: "membership",
  time: "membership",
  hotspot: "license_key",
};

const PERMS: Record<string, RoleName[]> = {
  "users.read": ["operator", "admin", "super_admin"],
  "users.ban": ["admin", "super_admin"],
  "users.quota": ["operator", "admin", "super_admin"],
  "users.membership": ["operator", "admin", "super_admin"],
  "users.role": ["admin", "super_admin"],
  "developer.review": ["admin", "super_admin"],
  "components.write": ["admin", "super_admin"],
  "submissions.review": ["reviewer", "admin", "super_admin"],
  "plans.write": ["admin", "super_admin"],
  "keys.write": ["operator", "admin", "super_admin"],
  "orders.confirm": ["operator", "admin", "super_admin"],
  "jobs.read": ["operator", "admin", "super_admin"],
  "builds.manage": ["operator", "admin", "super_admin"],
  "config.write": ["admin", "super_admin"],
  "audit.read": ["admin", "super_admin"],
  "announce.write": ["operator", "admin", "super_admin"],
};

export function allows(roles: string[], perm: string): boolean {
  if (roles.includes("super_admin")) return true;
  const list = PERMS[perm];
  if (!list) return false;
  return roles.some((role) => list.includes(role as RoleName));
}

export function isStaff(roles: string[]): boolean {
  return roles.some((role) => role === "reviewer" || role === "operator" || role === "admin" || role === "super_admin");
}

export function roleChangeError(input: {
  actorId: string;
  actorRoles: string[];
  targetId: string;
  targetRoles: string[];
  role: string;
  grant: boolean;
  superAdminCount: number;
}): string | null {
  if (!allows(input.actorRoles, "users.role")) return "没有调整角色的权限";
  if (!ROLES.includes(input.role as RoleName)) return "未知角色";
  if (input.role === "super_admin" && !input.actorRoles.includes("super_admin")) return "只有超级管理员能变更超级管理员";
  const has = input.targetRoles.includes(input.role);
  if (input.grant && has) return "已经有这个角色";
  if (!input.grant && !has) return "对方没有这个角色";
  if (!input.grant && input.role === "super_admin" && input.superAdminCount <= 1) return "至少保留一个超级管理员";
  return null;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export type AccessRow = {
  slug: string;
  access: string;
  status: string;
  name: string;
  category?: string;
};

export function accessReason(
  row: AccessRow | undefined,
  ctx: { member: boolean; granted: boolean; staff: boolean; memberCategories?: string[] | null },
): string | null {
  if (!row) return "这个组件不在目录里";
  if (row.status !== "published") return `${row.name}已下架`;
  if (row.access === "disabled") return `${row.name}已停止分发`;
  if (row.access === "public_free") return null;
  if (row.access === "internal") return ctx.staff ? null : `${row.name}仅内部使用`;
  if (row.access === "membership") {
    if (!ctx.member) return `${row.name}需要有效会员`;
    // 套餐限定了组件分类时，只有这些分类的会员组件可用（管理员授权的组件不受影响）。
    if (ctx.memberCategories?.length && !ctx.granted && !ctx.memberCategories.includes(row.category ?? "")) return `${row.name}不在当前套餐的组件范围内`;
    return null;
  }
  if (row.access === "license_key" || row.access === "specific_user") {
    return ctx.granted ? null : `${row.name}需要组件授权`;
  }
  return `${row.name}当前不可用`;
}

export function submissionIssues(input: {
  name: string;
  slug: string;
  category: string;
  summary: string;
  version: string;
  schemaText: string;
}): string[] {
  const issues: string[] = [];
  if (input.name.length < 1 || input.name.length > 40) issues.push("名称需要 1 到 40 个字");
  if (!/^[a-z][a-z0-9-]{2,32}$/.test(input.slug)) issues.push("标识要像 my-widget，小写字母开头");
  if (!["基础", "布局", "图形", "数据", "交互", "装饰"].includes(input.category)) issues.push("分类不在允许范围内");
  if (input.summary.length < 4 || input.summary.length > 400) issues.push("说明需要 4 到 400 个字");
  if (!/^\d+\.\d+\.\d+$/.test(input.version)) issues.push("版本要像 1.0.0");
  if (input.schemaText.length > 20_000) issues.push("Schema 超过 20KB");
  try {
    const parsed = JSON.parse(input.schemaText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) issues.push("Schema 必须是 JSON 对象");
    else {
      const blob = JSON.stringify(parsed).toLowerCase();
      if (/"script"|eval\(|function\s*\(|<script|child_process|process\.env/.test(blob)) {
        issues.push("Schema 里不能带脚本或可执行内容");
      }
    }
  } catch {
    issues.push("Schema 不是合法 JSON");
  }
  return issues;
}

export function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
