import { ApiError } from "./errors";
/** Validate against the exact immutable snapshot loaded for delivery, before billing. */
export function checkDeliveryRevision(
  body: Record<string, unknown>,
  revision: number,
  contentSha256: string,
) {
  if (body.expectedRevision === undefined)
    throw new ApiError(428, "请先同步并明确确认 expectedRevision 后再交付");
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== revision) {
    throw new ApiError(409, "云端修订已变化，交付已阻止；请重新同步并确认版本", { revision });
  }
  if (body.expectedContentSha256 !== undefined && body.expectedContentSha256 !== contentSha256) {
    throw new ApiError(409, "云端内容摘要已变化，交付已阻止");
  }
}
