import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/duel")({
  component: function RetiredDuel() {
    return <Navigate to="/" />;
  },
});
