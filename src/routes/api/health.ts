import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        try {
          const { getSql, dbSource } = await import("@/lib/db");
          const sql = await getSql();
          await sql`select 1`;
          return Response.json({ ok: true, service: "blueos-workshop", db: dbSource, dbMs: Date.now() - started });
        } catch {
          return Response.json({ ok: false, service: "blueos-workshop", db: "unreachable" }, { status: 503 });
        }
      },
    },
  },
});
