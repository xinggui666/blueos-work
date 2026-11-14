/** Identity-scoped persistence. Legacy unowned keys are intentionally never adopted. */
export type Workspace = { origin: string; userId: string; epoch: number };
export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
let current: Workspace | null = null;
let epoch = 0;
export function workspace() {
  return current;
}
export function activateWorkspace(origin: string, userId: string | null): Workspace | null {
  const normalized = new URL(origin).origin;
  if (current?.origin === normalized && current.userId === userId) return current;
  epoch++;
  current = userId ? { origin: normalized, userId, epoch } : null;
  return current;
}
export function isCurrent(value: Workspace | null): boolean {
  return !!value && current === value;
}
export function scopedKey(key: string, scope = current): string | null {
  return scope
    ? `bw-workspace-v3:${encodeURIComponent(scope.origin)}:${encodeURIComponent(scope.userId)}:${key}`
    : null;
}
export function scopedStorage(store: KV): KV {
  return {
    getItem(key) {
      const name = scopedKey(key);
      return name ? store.getItem(name) : null;
    },
    setItem(key, value) {
      const name = scopedKey(key);
      if (name) store.setItem(name, value);
    },
    removeItem(key) {
      const name = scopedKey(key);
      if (name) store.removeItem(name);
    },
  };
}
export function serverOrigin(): string {
  const native = (window as Window & { BlueOSNative?: { session(): string } }).BlueOSNative;
  if (native) {
    const session = JSON.parse(native.session()) as { base: string };
    return new URL(session.base).origin;
  }
  return window.location.origin;
}

export function deletedProjects(store: KV): string[] {
  const raw = scopedStorage(store).getItem("blueos-deleted-projects-v3");
  const value: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
    throw new Error("删除记录损坏，原始数据已保留");
  return value;
}
export function rememberDeletion(store: KV, id: string) {
  const ids = [...new Set([...deletedProjects(store), id])];
  scopedStorage(store).setItem("blueos-deleted-projects-v3", JSON.stringify(ids));
}
export function forgetDeletion(store: KV, id: string) {
  scopedStorage(store).setItem(
    "blueos-deleted-projects-v3",
    JSON.stringify(deletedProjects(store).filter((value) => value !== id)),
  );
}
