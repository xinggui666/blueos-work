import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { DownloadBar } from "@/components/platform/downloads";
import { useMe } from "@/lib/platform/client";

const LINKS = [
  { to: "/", label: "工程" },
  { to: "/market", label: "商城" },
  { to: "/account", label: "权益" },
  { to: "/jobs", label: "任务" },
] as const;

export function RequireUser({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <main className="grid min-h-dvh place-items-center text-sm text-muted">正在核对登录…</main>;
  if (!user) return <RedirectToSignIn />;
  return children;
}

export function AppFrame({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { data } = useMe<{ staff: boolean; announcements: { id: string; title: string }[]; release: { versionName: string; notes: string; apkUrl: string; force: boolean } | null }>();
  return (
    <div className="min-h-dvh pb-24 lg:pb-0">
      <header className="glass sticky top-0 z-30 border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-2xl border border-line bg-white shadow-sm">
              <span className="size-4 rounded-full border-2 border-accent" />
            </span>
            <span className="text-sm font-semibold tracking-tight">BlueOS 工坊</span>
          </Link>
          <nav className="studio-scroll hidden min-w-0 flex-1 gap-1 overflow-x-auto rounded-full bg-white/70 p-1 lg:flex">
            {LINKS.map((link) => {
              const active = link.to === "/" ? path === "/" : path.startsWith(link.to);
              return (
                <Link key={link.to} to={link.to} className={`shrink-0 rounded-full px-3 py-2 text-sm ${active ? "bg-white text-fg shadow-sm" : "text-muted"}`}>
                  {link.label}
                </Link>
              );
            })}
            <Link to="/developer" className={`shrink-0 rounded-full px-3 py-2 text-sm ${path.startsWith("/developer") ? "bg-white text-fg shadow-sm" : "text-muted"}`}>
              投稿
            </Link>
            {data?.staff ? (
              <Link to="/admin" className={`shrink-0 rounded-full px-3 py-2 text-sm ${path.startsWith("/admin") ? "bg-white text-fg shadow-sm" : "text-muted"}`}>
                后台
              </Link>
            ) : null}
          </nav>
          <UserButton />
        </div>
      </header>
      {data?.release?.notes ? (
        <p className="border-b border-line bg-white/80 px-4 py-2 text-center text-xs text-muted">
          客户端 {data.release.versionName}
          {data.release.force ? " · 需要更新" : ""}
          {data.release.apkUrl ? "" : " · 还没有安装包"}
          {" · "}
          {data.release.notes}
        </p>
      ) : null}
      {data?.announcements?.[0] ? (
        <p className="border-b border-line bg-bg px-4 py-2 text-center text-xs text-muted">{data.announcements[0].title}</p>
      ) : null}
      {children}
      <DownloadBar />
      <nav className="glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line lg:hidden">
        {LINKS.map((link) => {
          const active = link.to === "/" ? path === "/" : path.startsWith(link.to);
          return (
            <Link key={link.to} to={link.to} className={`flex min-h-14 items-center justify-center text-sm ${active ? "font-semibold text-accent" : "text-muted"}`}>
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}