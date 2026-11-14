/**
 * Android 原生桥（WebView ↔ Java）。
 *
 * - 网络请求全部由原生发出：登录令牌只存在原生的私有存储里，页面脚本拿不到。
 * - 原生通过 `window.__bwNative.resolve(id, status, body)` 回传异步结果，
 *   status 是 HTTP 状态码，0 表示没有网络或连不上服务器。
 * - 原生通过 `window.__bwNative.emit(name, json)` 推送事件（网络恢复、会话失效等）。
 */

export type NativeUser = { id: string; name: string; email: string };
export type NativeSession = {
  signedIn: boolean;
  base: string;
  user: NativeUser | null;
  expired: boolean;
};
export type AppInfo = {
  versionName: string;
  versionCode: number;
  debug: boolean;
  packageName: string;
  sdk: number;
  device: string;
  bridgeVersion?: number;
  webViewVersion?: string;
};

type NativeApi = {
  call(id: string, action: string, payloadJson: string): void;
  signIn(
    id: string,
    base: string,
    email: string,
    password: string,
    register: boolean,
    name: string,
  ): void;
  signOut(): void;
  session(): string;
  online(): boolean;
  appInfo(): string;
  saveFile(id: string, fileName: string, mime: string, base64: string): void;
  installUpdate(id: string, url: string, sha256: string): void;
  openExternal(url: string): void;
  reloadBundledApp?(): void;
};

type Pending = {
  resolve: (value: { status: number; body: string }) => void;
  reject: (reason: NativeError) => void;
  timer: ReturnType<typeof setTimeout>;
};

declare global {
  interface Window {
    BlueOSNative?: NativeApi;
    __bwBoot?: { fail(code: string): void; ready(): void };
    __bwNative?: {
      resolve(id: string, status: number, body: string): void;
      emit(name: string, json: string): void;
    };
  }
}

const pending = new Map<string, Pending>();
let seq = 0;
// A fresh page epoch prevents late callbacks from a previous document resolving a new request.
const requestEpoch = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
const listeners = new Map<string, Set<(data: unknown) => void>>();

window.__bwNative = {
  resolve(id, status, body) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (!Number.isInteger(status) || status < 0 || status > 599 || typeof body !== "string") {
      entry.reject(
        new NativeError("原生响应格式异常，操作状态需核对", 500, "BW_BRIDGE_V1_RESPONSE"),
      );
      return;
    }
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

function request(
  start: (id: string) => void,
  timeoutMs = 60_000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const id = `r:${requestEpoch}:${++seq}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new NativeError(
          "原生操作等待超时；它可能仍在后台进行，请先核对文件或安装状态，再重试。本机草稿未清除。",
          0,
          "BW_BRIDGE_V1_TIMEOUT",
        ),
      );
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      start(id);
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      reject(
        new NativeError("原生桥调用失败，请保留数据重新载入或更新客户端", 500, "BW_BRIDGE_V1_CALL"),
      );
    }
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
  readonly protocolVersion = 1;
  constructor(
    message: string,
    readonly status: number,
    readonly code = "BW_BRIDGE_V1_HTTP",
  ) {
    super(message);
    this.name = "NativeError";
  }
}

/** 调用 /api/v1/platform。成功返回结果对象，失败抛出带中文说明的错误。 */
export async function platformCall<T>(action: string, payload: unknown): Promise<T> {
  const { status, body } = await request((id) =>
    native().call(id, action, JSON.stringify(payload ?? {})),
  );
  if (status === 0) throw new NativeError(body || OFFLINE_MESSAGE, 0, "BW_BRIDGE_V1_OFFLINE");
  if (status === 401) {
    markExpired();
    throw new NativeError("登录已过期，请重新登录（本机工程不会丢失）", 401, "BW_BRIDGE_V1_AUTH");
  }
  const data = parse(body);
  if (status >= 400)
    throw new NativeError(String(data.error || data.message || `请求失败（${status}）`), status);
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object") throw new Error();
    return value as T;
  } catch {
    throw new NativeError("服务器响应格式异常，未继续处理", 502, "BW_BRIDGE_V1_RESPONSE");
  }
}

export async function signIn(
  base: string,
  email: string,
  password: string,
  register: boolean,
  name: string,
): Promise<void> {
  const { status, body } = await request(
    (id) => native().signIn(id, base, email, password, register, name),
    120_000,
  );
  if (status === 200) return;
  if (status === 0)
    throw new NativeError(body || "连不上服务器，请检查地址和网络", 0, "BW_BRIDGE_V1_OFFLINE");
  const data = parse(body);
  throw new NativeError(
    String(data.message || data.error || `登录失败（${status}）`),
    status,
    "BW_BRIDGE_V1_AUTH",
  );
}

export function readSession(): NativeSession {
  try {
    const s: unknown = JSON.parse(native().session());
    if (!s || typeof s !== "object") throw new Error();
    const v = s as NativeSession;
    if (
      typeof v.signedIn !== "boolean" ||
      typeof v.base !== "string" ||
      (v.signedIn &&
        (!v.user ||
          typeof v.user.id !== "string" ||
          !v.user.id ||
          typeof v.user.name !== "string" ||
          typeof v.user.email !== "string" ||
          !/^https?:$/.test(new URL(v.base).protocol)))
    )
      throw new Error();
    return { ...v, expired: Boolean(v.expired), user: v.signedIn ? v.user : null };
  } catch {
    throw new NativeError(
      "原生会话格式异常；已停止加载，未删除本机数据",
      500,
      "BW_BRIDGE_V1_SESSION",
    );
  }
}

export function appInfo(): AppInfo {
  try {
    const value = JSON.parse(native().appInfo()) as AppInfo;
    if (!Number.isInteger(value.versionCode) || typeof value.versionName !== "string")
      throw new Error();
    return value;
  } catch {
    throw new NativeError("原生版本信息异常，请保留数据重试", 500, "BW_BRIDGE_V1_INFO");
  }
}

export async function saveFile(fileName: string, mime: string, base64: string): Promise<boolean> {
  const { status, body } = await request(
    (id) => native().saveFile(id, fileName, mime, base64),
    600_000,
  );
  if (status === 200) return true;
  if (status === 499) return false;
  throw new NativeError(body || "保存失败", status, "BW_BRIDGE_V1_FILE");
}

export async function installUpdate(url: string, sha256: string): Promise<string> {
  const { status, body } = await request((id) => native().installUpdate(id, url, sha256), 300_000);
  if (status === 200) return body || "已交给系统安装";
  throw new NativeError(body || "更新失败", status, "BW_BRIDGE_V1_UPDATE");
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
