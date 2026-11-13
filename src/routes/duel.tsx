import { createFileRoute } from "@tanstack/react-router";
import { DuelView } from "@/components/duel/duel-view";

export const Route = createFileRoute("/duel")({
  component: DuelView,
});
