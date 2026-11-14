import { StrictMode, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { CloudSync, call, errorText, useCloud } from "@/lib/platform/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { HomeView } from "@/components/studio/home-view";
import { EditorView } from "@/components/studio/editor-view";
import { MarketView } from "@/components/platform/market-view";
import { AccountView } from "@/components/platform/account-view";
import { JobsView } from "@/components/platform/jobs-view";
import { DeveloperView } from "@/components/platform/developer-view";
import { useStudio } from "@/lib/blueos/store";
import { appInfo, currentSession, installUpdate, loadSession, native, onNative, signIn, subscribeSession } from "./bridge";

/* ---------- 网络状态 ---------- */

let online = true;
const onlineListeners = new Set<() => void>();
function setOnline(next: boolean) {
  if (next === online) return;
  online = next;
  onlineListeners.forEach((fn) => fn());
}
function useOnline() {
  return useSyncExternalStore(
    (fn) => {
      onlineListeners.add(fn);
      return () => onlineListeners.delete(fn);
    },
    () => online,
  );
}

/** 每次网络恢复加一，CloudSync 用它作为 key 重新挂载，从而重新合并本地与云端（冲突保留双方）。 */
let epoch = 0;
const epochListeners = new Set<() => void>();
function useEpoch() {
  return useSyncExternalStore(
    (fn) => {
      epochListeners.add(fn);
      return () => epochListeners.delete(fn);
    },
    () => epoch,
  );
}

function startNetworkWatch() {
  online = native().online();
  onNative("network", (data) => {
    const next = Boolean((data as { online?: boolean })?.online);
    const wasOffline = !online;
    setOnline(next);
    if (next && wasOffline) {
      epoch += 1;
      epochListeners.forEach((fn) => fn());
    }
  });
}

/* ---------- 版本更新 ---------- */

type Release = { versionName: string; versionCode: number; notes: string; apkUrl: string; sha256: string; sizeBytes: number; downloadable: boolean; force: boolean };
type ReleaseCheck = { update: boolean; force: boolean; release: Release | null };

const CHANNEL_KEY = "bw-update-channel";
function channel(): "stable" | "beta" {
  return localStorage.getItem(CHANNEL_KEY) === "beta" ? "beta" : "stable";
}

function checkRelease(): Promise<ReleaseCheck> {
  return call<ReleaseCheck>("releaseCheck", { versionCode: appInfo().versionCode, channel: channel() }, "android");
}

function UpdateGate({ children }: { children: ReactNode }) {
  const isOnline = useOnline();
  const [check, setCheck] = useState<ReleaseCheck | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!isOnline) return;
    let live = true;
    checkRelease()
      .then((value) => live && setCheck(value))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [isOnline]);
  if (check?.force && check.update && check.release && check.release.versionCode > appInfo().versionCode && !hidden) {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5">
          <p className="text-lg font-semibold">需要更新</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            当前版本 {appInfo().versionName} 已停止支持，请更新到 {check.release.versionName}。{check.release.notes}
          </p>
          <UpdateButton release={check.release} />
          <button type="button" className="mt-4 min-h-11 text-sm text-accent" onClick={() => { setHidden(true); }}>更新失败或暂时无法安装：返回本机工作空间</button>
          <p className="mt-2 text-xs text-muted">继续使用不绕过服务器权限。请稍后在设置中重试更新。</p>
        </div>
      </main>
    );
  }
  return (
    <>
      {check?.update && check.release && !hidden ? (
        <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-2 text-xs">
          <span className="min-w-0 flex-1 text-muted">
            有新版本 {check.release.versionName}
            {check.release.downloadable ? "" : "（还没有可下载的安装包）"}
          </span>
          <Link to={"/settings" as never} className="text-accent">
            查看
          </Link>
          <button type="button" className="text-muted" onClick={() => setHidden(true)}>
            关闭
          </button>
        </div>
      ) : null}
      {children}
    </>
  );
}

function UpdateButton({ release }: { release: Release }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  if (!release.downloadable) return <p className="mt-3 text-sm text-warn">这个版本还没有可下载的安装包（缺少下载地址或 SHA-256），暂时不能更新。</p>;
  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={busy}
        className="min-h-11 w-full rounded-md bg-accent text-sm font-semibold text-accent-fg disabled:opacity-60"
        onClick={() => {
          setBusy(true);
          setNote("正在下载并校验 SHA-256…");
          installUpdate(release.apkUrl, release.sha256)
            .then(setNote)
            .catch((error) => setNote(errorText(error)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "正在下载…" : `下载并安装 ${release.versionName}`}
      </button>
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
    </div>
  );
}

/* ---------- 外框 ---------- */

const TABS = [
  { to: "/", label: "工程" },
  { to: "/market", label: "商城" },
  { to: "/account", label: "权益" },
  { to: "/jobs", label: "任务" },
  { to: "/settings", label: "设置" },
] as const;

function RequireUser({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  if (!user) return <Navigate to="/login" />;
  return children;
}

function StatusBar() {
  const isOnline = useOnline();
  const cloud = useCloud();
  const text = !isOnline ? "离线：可以编辑已缓存的工程，联网后自动同步；构建、下载和组件授权需要联网" : cloud.status === "error" ? cloud.detail : "";
  if (!text) return null;
  return (
    <p data-testid="net-status" className={`border-b border-line px-4 py-2 text-xs ${isOnline ? "bg-white text-warn" : "bg-amber-50 text-amber-800"}`}>
      {text}
    </p>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <RequireUser>
      <UpdateGate>
        <div className="min-h-dvh pb-20">
          <StatusBar />
          {children}
          <nav className="glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            {TABS.map((tab) => {
              const active = tab.to === "/" ? path === "/" : path.startsWith(tab.to);
              return (
                <Link key={tab.to} to={tab.to as never} className={`flex min-h-14 items-center justify-center text-sm ${active ? "font-semibold text-accent" : "text-muted"}`}>
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </UpdateGate>
    </RequireUser>
  );
}

/* ---------- 登录 ---------- */

function LoginPage() {
  const session = useSyncExternalStore(subscribeSession, currentSession);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [base, setBase] = useState(session.base || "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(session.user?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (session.signedIn && !session.expired) return <Navigate to="/" />;

  async function submit() {
    setError("");
    if (!base.trim() || !email.trim() || !password) {
      setError("请填写服务器地址、邮箱和密码");
      return;
    }
    setBusy(true);
    try {
      await signIn(base.trim(), email.trim(), password, mode === "up", name.trim() || "工坊用户");
      // 整页重载：启动流程会按新账号切换本机缓存。
      window.location.hash = "#/";
      window.location.reload();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  const field = "min-h-12 w-full rounded-md border border-line bg-white px-3 text-base";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-3 px-6 py-10">
      <p className="text-2xl font-semibold tracking-tight">BlueOS 工坊</p>
      <p className="text-sm text-muted">{session.expired ? "登录已过期，请重新登录。本机工程都还在。" : "登录后工程会同步到云端，也能离线编辑。"}</p>
      <div className="mt-2 grid grid-cols-2 rounded-full bg-white p-1 text-sm">
        <button type="button" className={`min-h-10 rounded-full ${mode === "in" ? "bg-accent text-accent-fg" : ""}`} onClick={() => setMode("in")}>
          登录
        </button>
        <button type="button" className={`min-h-10 rounded-full ${mode === "up" ? "bg-accent text-accent-fg" : ""}`} onClick={() => setMode("up")}>
          注册
        </button>
      </div>
      <label className="text-sm">
        服务器地址
        <input aria-label="服务器地址" className={field} inputMode="url" autoCapitalize="none" placeholder="https://你的服务器" value={base} onChange={(e) => setBase(e.target.value)} />
      </label>
      {mode === "up" ? (
        <label className="text-sm">
          昵称
          <input aria-label="昵称" className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      ) : null}
      <label className="text-sm">
        邮箱
        <input aria-label="邮箱" className={field} type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="text-sm">
        密码
        <input aria-label="密码" className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
      </label>
      <button type="button" disabled={busy} className="mt-2 min-h-12 rounded-md bg-accent text-base font-semibold text-accent-fg disabled:opacity-60" onClick={() => void submit()}>
        {busy ? "请稍候…" : mode === "up" ? "注册并登录" : "登录"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      ) : null}
    </main>
  );
}

/* ---------- 设置 ---------- */

function SettingsPage() {
  const session = useSyncExternalStore(subscribeSession, currentSession);
  const info = appInfo();
  const isOnline = useOnline();
  const cloud = useCloud();
  const projects = useStudio((state) => state.projects);
  const [check, setCheck] = useState<ReleaseCheck | null>(null);
  const [note, setNote] = useState("");
  const [beta, setBeta] = useState(channel() === "beta");
  let cacheBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) ?? "";
    cacheBytes += key.length + (localStorage.getItem(key)?.length ?? 0);
  }
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <p className="text-lg font-semibold">设置</p>
      <section className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm leading-7">
        <p>账号：{session.user?.email}</p>
        <p className="break-all">服务器：{session.base}</p>
        <p>网络：{isOnline ? "在线" : "离线"}</p>
        <p>云端同步：{cloud.detail || "等待同步"}</p>
        <p>
          本机缓存：{projects.length} 个工程，约 {(cacheBytes / 1024).toFixed(0)} KB
        </p>
      </section>
      <section className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm leading-7">
        <p>
          版本：{info.versionName}（{info.versionCode}）{info.debug ? " · 调试包" : ""}
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={beta}
            onChange={(e) => {
              localStorage.setItem(CHANNEL_KEY, e.target.checked ? "beta" : "stable");
              setBeta(e.target.checked);
              setCheck(null);
            }}
          />
          接收测试版
        </label>
        <button
          type="button"
          className="mt-2 min-h-11 rounded-md border border-line px-4"
          onClick={() => {
            setNote("正在检查…");
            checkRelease()
              .then((value) => {
                setCheck(value);
                setNote(value.release ? (value.update ? `有新版本 ${value.release.versionName}` : "已是最新版本") : "服务器还没有发布任何版本");
              })
              .catch((error) => setNote(errorText(error)));
          }}
        >
          检查更新
        </button>
        {note ? <p className="text-muted">{note}</p> : null}
        {check?.update && check.release ? (
          <div className="mt-2">
            <p className="text-muted">{check.release.notes}</p>
            <UpdateButton release={check.release} />
          </div>
        ) : null}
      </section>
      <button
        type="button"
        className="mt-6 min-h-11 w-full rounded-md border border-line text-warn"
        onClick={() => {
          native().signOut();
          loadSession();
          window.location.hash = "#/login";
          window.location.reload();
        }}
      >
        退出登录（本机工程保留在这台手机上）
      </button>
    </main>
  );
}

/* ---------- 路由 ---------- */

function Root() {
  const { user } = useCurrentUserState();
  const n = useEpoch();
  return (
    <>
      {user ? <CloudSync key={`${user.id}:${n}`} /> : null}
      <Outlet />
    </>
  );
}

function EditorPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  return (
    <RequireUser>
      <UpdateGate>
      <StatusBar />
      <div className="flex h-dvh flex-col">
        <div className="min-h-0 flex-1">
          <EditorView projectId={id} />
        </div>
      </div>
      </UpdateGate>
    </RequireUser>
  );
}

const rootRoute = createRootRoute({ component: Root });
const page = (path: string, element: () => ReactNode) => createRoute({ getParentRoute: () => rootRoute, path, component: element });
const routeTree = rootRoute.addChildren([
  page("/", () => (
    <Frame>
      <HomeView />
    </Frame>
  )),
  page("/edit/$id", () => <EditorPage />),
  page("/market", () => (
    <Frame>
      <MarketView />
    </Frame>
  )),
  page("/account", () => (
    <Frame>
      <AccountView />
    </Frame>
  )),
  page("/jobs", () => (
    <Frame>
      <JobsView />
    </Frame>
  )),
  page("/developer", () => (
    <Frame>
      <DeveloperView />
    </Frame>
  )),
  page("/admin", () => (
    <Frame>
      <p className="px-4 py-10 text-center text-sm text-muted">管理后台请在网页端打开（{currentSession().base}/admin）。</p>
    </Frame>
  )),
  page("/settings", () => (
    <Frame>
      <SettingsPage />
    </Frame>
  )),
  page("/login", () => <LoginPage />),
]);

export function mount(root: HTMLElement) {
  startNetworkWatch();
  const router = createRouter({ routeTree, history: createHashHistory() });
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
