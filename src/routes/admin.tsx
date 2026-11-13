import { createFileRoute } from "@tanstack/react-router";
import { AdminView } from "@/components/platform/admin-view";
import { AppFrame, RequireUser } from "@/components/platform/frame";

export const Route = createFileRoute("/admin")({
  component: () => (
    <RequireUser>
      <AppFrame>
        <AdminView />
      </AppFrame>
    </RequireUser>
  ),
});
