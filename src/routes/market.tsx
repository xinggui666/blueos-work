import { createFileRoute } from "@tanstack/react-router";
import { AppFrame, RequireUser } from "@/components/platform/frame";
import { MarketView } from "@/components/platform/market-view";

export const Route = createFileRoute("/market")({
  component: () => (
    <RequireUser>
      <AppFrame>
        <MarketView />
      </AppFrame>
    </RequireUser>
  ),
});
