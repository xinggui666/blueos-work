/**
 * Android 原生桥（WebView ↔ Java）。
 *
 * - 网络请求全部由原生发出：登录令牌只存在原生的私有存储里，页面脚本拿不到。
 * - 原生通过 `window.__bwNative.resolve(id, status, body)` 回传异步结果，
 *   status 是 HTTP 状态码，0 表示没有网络或连不上服务器。
 * - 原生通过 `window.__bwNative.emit(name, json)` 推送事件（网络恢复、会话失效等）。
 */

export type NativeUser = { id: string; name: string; email: string };
export type NativeSession = { signedIn: boolean; base: string; user: NativeUser | null; expired: boolean };
export type AppInfo = { versionName: string; versionCode: number; debug: boolean; packageName: string; sdk: number; device: string };

type NativeApi = {
  call(id: string, action: string, payloadJson: string): void;
  signIn(id: string, base: string, email: string, password: string, register: boolean, name: string): void;
  signOut(): void;
  session(): string;
  online(): boolean;
  appInfo(): string;
  saveFile(id: string, fileName: string, mime: string, base64: string): void;
  installUpdate(id: string, url: string, sha256: string): void;
  openExternal(url: string): void;
};

type Pending = { resolve: (value: { status: number; body: string }) => void };

declare global {
  interface Window {
    BlueOSNative?: NativeApi;
    __bwNative?: { resolve(id: string, status: number, body: string): void; emit(name: string, json: string): void };
  }
}

const pending = new Map<string, Pending>();
let seq = 0;
const listeners = new Map<string, Set<(data: unknown) => void>>();

window.__bwNative = {
  resolve(id, status, body) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    entry.resolve({ status, body });
  },
  emit(name, json) {
    let data: unknown = null;
    try {
      data = JSON.parse(json);
    } catch {
      data = json;
    }
    listeners.get(name)?.forEach((fn) => fn(data));
  },
};

export function native(): NativeApi {
  const api = window.BlueOSNative;
  if (!api) throw new Error("这个页面只能在 BlueOS 工坊 Android 客户端里运行");
  return api;
}

export function hasNative(): boolean {
  return Boolean(window.BlueOSNative);
}

export function onNative(name: string, fn: (data: unknown) => void): () => void {
  const set = listeners.get(name) ?? new Set();
  set.add(fn);
  listeners.set(name, set);
  return () => set.delete(fn);
}

function request(start: (id: string) => void): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const id = `r${++seq}`;
    pending.set(id, { resolve });
    start(id);
  });
}

export const OFFLINE_MESSAGE = "网络不可用：修改已保存在本机，联网后自动同步";

function parse(body: string): Record<string, unknown> {
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : { value };
  } catch {
    return { error: body };
  }
}

export class NativeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 调用 /api/v1/platform。成功返回结果对象，失败抛出带中文说明的错误。 */
export async function platformCall<T>(action: string, payload: unknown): Promise<T> {
  const { status, body } = await request((id) => native().call(id, action, JSON.stringify(payload ?? {})));
  if (status === 0) throw new NativeError(body || OFFLINE_MESSAGE, 0);
  if (status === 401) {
    markExpired();
    throw new NativeError("登录已过期，请重新登录（本机工程不会丢失）", 401);
  }
  const data = parse(body);
  if (status >= 400) throw new NativeError(String(data.error || data.message || `请求失败（${status}）`), status);
  return data as T;
}

export async function signIn(base: string, email: string, password: string, register: boolean, name: string): Promise<void> {
  const { status, body } = await request((id) => native().signIn(id, base, email, password, register, name));
  if (status === 200) return;
  if (status === 0) throw new Error(body || "连不上服务器，请检查地址和网络");
  const data = parse(body);
  throw new Error(String(data.message || data.error || `登录失败（${status}）`));
}

export function readSession(): NativeSession {
  try {
    return JSON.parse(native().session()) as NativeSession;
  } catch {
    return { signedIn: false, base: "", user: null, expired: false };
  }
}

export function appInfo(): AppInfo {
  return JSON.parse(native().appInfo()) as AppInfo;
}

export async function saveFile(fileName: string, mime: string, base64: string): Promise<boolean> {
  const { status, body } = await request((id) => native().saveFile(id, fileName, mime, base64));
  if (status === 200) return true;
  if (status === 499) return false;
  throw new Error(body || "保存失败");
}

export async function installUpdate(url: string, sha256: string): Promise<string> {
  const { status, body } = await request((id) => native().installUpdate(id, url, sha256));
  if (status === 200) return body || "已交给系统安装";
  throw new Error(body || "更新失败");
}

/* ---------- 会话状态（给 useCurrentUserState 用） ---------- */

let session: NativeSession = { signedIn: false, base: "", user: null, expired: false };
const sessionListeners = new Set<() => void>();

export function loadSession(): NativeSession {
  session = readSession();
  sessionListeners.forEach((fn) => fn());
  return session;
}

export function currentSession(): NativeSession {
  return session;
}

export function subscribeSession(fn: () => void): () => void {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

function markExpired() {
  if (session.expired) return;
  session = { ...session, expired: true };
  sessionListeners.forEach((fn) => fn());
}

onNative("session", () => loadSession());
