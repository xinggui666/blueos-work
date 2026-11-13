import { createFileRoute } from "@tanstack/react-router";
import { AccountView } from "@/components/platform/account-view";
import { AppFrame, RequireUser } from "@/components/platform/frame";

export const Route = createFileRoute("/account")({
  component: () => (
    <RequireUser>
      <AppFrame>
        <AccountView />
      </AppFrame>
    </RequireUser>
  ),
});
