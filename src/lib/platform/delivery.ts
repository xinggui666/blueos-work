/** Both UI delivery paths must pass this gate before any billable API call. */
export type SyncReceipt = {
  ok: boolean;
  revision?: number;
  contentSha256?: string;
  conflict?: boolean;
  message?: string;
};
export async function prepareDelivery(
  project: unknown,
  invoke: (action: string, payload: unknown) => Promise<unknown>,
) {
  const receipt = (await invoke("syncProject", { project })) as SyncReceipt;
  if (receipt.ok !== true || !Number.isSafeInteger(receipt.revision) || receipt.revision! < 1) {
    throw new Error(receipt.message || "工程存在同步冲突，已阻止交付；请解决冲突或另存副本后重试");
  }
  return {
    expectedRevision: receipt.revision!,
    ...(receipt.contentSha256 ? { expectedContentSha256: receipt.contentSha256 } : {}),
  };
}
