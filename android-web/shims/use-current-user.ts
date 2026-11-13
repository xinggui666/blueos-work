/** Android 版替换 src/lib/auth/use-current-user.ts：用户来自原生保存的会话，离线也能打开已缓存工程。 */
import { useMemo, useSyncExternalStore } from "react";
import { currentSession, subscribeSession } from "../bridge";

export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
  isDevFallback: boolean;
};

export type CurrentUserState = { user: AppUser | null; isPending: boolean };

export function useCurrentUserState(): CurrentUserState {
  const session = useSyncExternalStore(subscribeSession, currentSession, currentSession);
  const id = session.signedIn && !session.expired ? session.user?.id : undefined;
  const name = session.user?.name ?? null;
  const email = session.user?.email ?? null;
  return useMemo(
    () => ({
      user: id ? { id, displayName: name, primaryEmail: email, profileImageUrl: null, isDevFallback: false } : null,
      isPending: false,
    }),
    [id, name, email],
  );
}

export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
