/** Shared wire budgets. Large actions contain bounded binary data, not larger project documents. */
export const NORMAL_REQUEST_BYTES = 1_000_000;
export const BINARY_REQUEST_BYTES = 12 * 1024 * 1024;
export function requestLimit(action: unknown): number {
  return action === "importBundle" || action === "previewImport"
    ? BINARY_REQUEST_BYTES
    : action === "uploadAsset"
      ? 3 * 1024 * 1024
      : NORMAL_REQUEST_BYTES;
}
export async function boundedRequestText(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > BINARY_REQUEST_BYTES) throw new Error("请求过大");
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let p = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, p);
    p += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
