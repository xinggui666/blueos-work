/** Android 版替换 src/lib/auth/gates.tsx（不引入 Better Auth 浏览器客户端）。 */
import type { ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { useCurrentUserState } from "./use-current-user";

export const SIGN_IN_PATH = "/login";

export function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  return user ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  return user ? null : <>{children}</>;
}

export function RedirectToSignIn({ to = SIGN_IN_PATH }: { to?: string }) {
  return <Navigate to={to} />;
}

export function UserButton() {
  const { user } = useCurrentUserState();
  return user ? <span className="text-sm font-medium">{user.displayName ?? user.primaryEmail}</span> : null;
}
