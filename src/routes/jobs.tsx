import { createFileRoute } from "@tanstack/react-router";
import { AppFrame, RequireUser } from "@/components/platform/frame";
import { JobsView } from "@/components/platform/jobs-view";

export const Route = createFileRoute("/jobs")({
  component: () => (
    <RequireUser>
      <AppFrame>
        <JobsView />
      </AppFrame>
    </RequireUser>
  ),
});
