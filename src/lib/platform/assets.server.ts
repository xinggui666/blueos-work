/** Owner-scoped, immutable binary storage. No disk paths, URL fetches, or executable formats. */
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { Sql } from "../db";
import { ASSET_MAX_BYTES, assertResourceReferences, checkAsset, pngInfo, type AssetFiles } from "../protocol/assets";
import type { AssetDoc, ProjectDoc } from "../protocol/schema";
import { ApiError, notFound } from "./errors";
export const FREE_ASSET_BYTES = 20 * 1024 * 1024;
export function pngAsset(data: Uint8Array): AssetDoc {
  const sha256 = createHash("sha256").update(data).digest("hex");
  return {
    id: `a${sha256.slice(0, 47)}`,
    kind: "image",
    path: `assets/${sha256}.png`,
    sha256,
    bytes: data.length,
    mime: "image/png",
  };
}
export function validateStoredAsset(asset: AssetDoc, data: Uint8Array): void {
  try {
    checkAsset(asset, data);
    if (createHash("sha256").update(data).digest("hex") !== asset.sha256)
      throw new Error("SHA-256 不符");
    const info = pngInfo(data),
      decoded = inflateSync(info.compressed, { maxOutputLength: info.decodedBytes });
    if (decoded.length !== info.decodedBytes) throw new Error("PNG 解压像素数据长度不符");
    for (let p = 0; p < decoded.length; p += info.rowBytes)
      if (decoded[p] > 4) throw new Error("PNG 行过滤器无效");
  } catch (error) {
    throw new ApiError(400, `资源 ${asset.path} 校验失败：${(error as Error).message}`);
  }
}
export function decodeAsset(base64: unknown): Uint8Array {
  if (
    typeof base64 !== "string" ||
    !base64.length ||
    base64.length > Math.ceil(ASSET_MAX_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    throw new ApiError(400, "资源 Base64 无效或超过 2MiB");
  const data = new Uint8Array(Buffer.from(base64, "base64"));
  if (Buffer.from(data).toString("base64") !== base64)
    throw new ApiError(400, "资源 Base64 非规范编码");
  return data;
}
export async function assetUsage(sql: Sql, userId: string) {
  const member = (
    await sql.query<{ snapshot: { storageMb?: unknown } }>(
      "select snapshot from current_membership_entitlements where user_id=$1",
      [userId],
    )
  )[0];
  const raw = member?.snapshot?.storageMb;
  const limitBytes =
    typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
      ? Math.min(raw, 1_000_000) * 1024 * 1024
      : FREE_ASSET_BYTES;
  const usage = (
    await sql.query<{ bytes: number; count: number }>(
      "select coalesce(sum(bytes),0)::bigint as bytes,count(*)::int as count from project_binary_assets where user_id=$1",
      [userId],
    )
  )[0];
  return { bytes: Number(usage?.bytes ?? 0), count: Number(usage?.count ?? 0), limitBytes };
}
/** Caller MUST provide a transaction. Shared profile row serializes distinct uploads/imports for quota. */
export async function storeAssets(tx: Sql, userId: string, assets: AssetDoc[], files: AssetFiles) {
  await tx.query("select user_id from profiles where user_id=$1 for update", [userId]);
  for (const asset of assets) {
    const data = files[asset.path];
    if (!data) throw new ApiError(400, `资源 ${asset.path} 缺失`);
    validateStoredAsset(asset, data);
    const found = (
      await tx.query("select sha256 from project_binary_assets where user_id=$1 and sha256=$2", [
        userId,
        asset.sha256,
      ])
    )[0];
    if (found) continue;
    const usage = await assetUsage(tx, userId);
    if (usage.bytes + data.length > usage.limitBytes)
      throw new ApiError(413, "资源存储配额不足（去重按账号计算；已有修订所需资源不自动删除）");
    await tx.query(
      "insert into project_binary_assets(user_id,sha256,bytes,mime,data_base64) values($1,$2,$3,'image/png',$4)",
      [userId, asset.sha256, data.length, Buffer.from(data).toString("base64")],
    );
  }
  return assetUsage(tx, userId);
}
export async function loadAssets(
  sql: Sql,
  userId: string,
  doc: Pick<ProjectDoc, "assets" | "pages">,
): Promise<AssetFiles> {
  try{assertResourceReferences(doc);}catch(error){throw new ApiError(400,(error as Error).message);}
  const files: AssetFiles = Object.create(null) as AssetFiles;
  for (const asset of doc.assets) {
    const row = (
      await sql.query<{ data_base64: string }>(
        "select data_base64 from project_binary_assets where user_id=$1 and sha256=$2",
        [userId, asset.sha256],
      )
    )[0];
    if (!row) throw new ApiError(400, `资源 ${asset.path} 缺失或不属于当前账号，交付被阻止`);
    const data = decodeAsset(row.data_base64);
    validateStoredAsset(asset, data);
    files[asset.path] = data;
  }
  return files;
}
export async function getAsset(sql: Sql, userId: string, sha256: unknown) {
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256))
    throw new ApiError(400, "无效资源摘要");
  const row = (
    await sql.query<{ data_base64: string }>(
      "select data_base64 from project_binary_assets where user_id=$1 and sha256=$2",
      [userId, sha256],
    )
  )[0];
  if (!row) throw notFound("资源不存在或不属于当前账号");
  const data = decodeAsset(row.data_base64),
    asset = pngAsset(data);
  validateStoredAsset(asset, data);
  return { asset, fileBase64: row.data_base64 };
}
