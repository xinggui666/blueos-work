import { createFileRoute } from "@tanstack/react-router";
import { DeveloperView } from "@/components/platform/developer-view";
import { AppFrame, RequireUser } from "@/components/platform/frame";

export const Route = createFileRoute("/developer")({
  component: () => (
    <RequireUser>
      <AppFrame>
        <DeveloperView />
      </AppFrame>
    </RequireUser>
  ),
});
