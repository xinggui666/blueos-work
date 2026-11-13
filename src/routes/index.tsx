import { createFileRoute } from "@tanstack/react-router";
import { AppFrame, RequireUser } from "@/components/platform/frame";
import { HomeView } from "@/components/studio/home-view";

export const Route = createFileRoute("/")({
  component: () => (
    <RequireUser>
      <AppFrame>
        <HomeView />
      </AppFrame>
    </RequireUser>
  ),
});
