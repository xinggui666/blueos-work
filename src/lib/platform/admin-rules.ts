/** 管理后台的纯规则（无数据库依赖，便于单测）。只在服务端使用。 */
import { createHash } from "node:crypto";

/** 资源文件只接受 PNG/JPEG/WebP（按文件头判断，不信任声明的类型），不接受 SVG（可带脚本）。 */
export function sniffImage(data: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && String.fromCharCode(...data.subarray(0, 4)) === "RIFF" && String.fromCharCode(...data.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}
export const ASSET_MAX_BYTES = 256 * 1024;
export const SEMVER = /^\d+\.\d+\.\d+$/;

/** 卡密安全清单：只含掩码提示，不含明文卡密（数据库只存哈希，明文生成后只显示一次）。 */
export function keysCsv(rows: { id: string; hint: string; type: string; status: string; expiresAt: string | null; usedBy: string; usedAt: string | null }[]) {
  const cell = (v: string) => {
    // 防 CSV 公式注入：以 = + - @ 开头的单元格前加单引号。
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = "id,hint,type,status,expires_at,used_by,used_at";
  return [head, ...rows.map((r) => [r.id, r.hint, r.type, r.status, r.expiresAt ?? "", r.usedBy, r.usedAt ?? ""].map(cell).join(","))].join("\n") + "\n";
}


/** 灰度分桶：同一用户 + 版本结果稳定。percent ≥ 100 全量；没有标识只推全量版本。 */
export function inRollout(releaseId: string, percent: number, subject: string): boolean {
  if (percent >= 100) return true;
  if (percent <= 0 || !subject) return false;
  const bucket = createHash("sha256").update(`${releaseId}:${subject}`).digest().readUInt16BE(0) % 100;
  return bucket < percent;
}
