/** @deprecated V2 compatibility helper/tests only. V3 startup uses shared origin+user workspace storage; never auto-adopts these legacy keys. */
/**
 * 本机缓存按账号隔离。
 * 编辑器把工程存在固定的 localStorage 键里；同一台手机换账号登录时，
 * 先把上一个账号的数据收进 `bw:<用户ID>:<键>`，再取出当前账号的数据。
 * 这样既不会把 A 的工程同步进 B 的账号，也不会删除 A 尚未同步的本机修改。
 */
export const CACHE_KEYS = ["blueos-studio-v1", "blueos-sync-state-v2"] as const;
export const OWNER_KEY = "bw-owner";

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function swapUserStorage(store: KV, userId: string): "same" | "adopted" | "swapped" {
  const owner = store.getItem(OWNER_KEY);
  if (owner === userId) return "same";
  if (!owner) {
    // 第一次登录：本机已有的数据（比如登录前的示例工程）归当前账号。
    store.setItem(OWNER_KEY, userId);
    return "adopted";
  }
  for (const key of CACHE_KEYS) {
    const active = store.getItem(key);
    if (active !== null) store.setItem(`bw:${owner}:${key}`, active);
    const saved = store.getItem(`bw:${userId}:${key}`);
    if (saved !== null) {
      store.setItem(key, saved);
      store.removeItem(`bw:${userId}:${key}`);
    } else store.removeItem(key);
  }
  store.setItem(OWNER_KEY, userId);
  return "swapped";
}
