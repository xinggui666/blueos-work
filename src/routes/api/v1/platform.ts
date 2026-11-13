import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { isClient } from "@/lib/contract/surface";

export const Route = createFileRoute("/api/v1/platform")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const header = request.headers.get("authorization") || "";
        const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        try {
          const userId = await requireUserId(token || undefined);
          const body = (await request.json()) as { action?: unknown; payload?: unknown; client?: unknown };
          if (typeof body.action !== "string" || !/^[a-zA-Z]{2,40}$/.test(body.action)) {
            return Response.json({ error: "无效请求" }, { status: 400 });
          }
          const client = isClient(body.client) ? body.client : "android";
          const { dispatch } = await import("@/lib/platform/logic.server");
          const result = await dispatch(userId, body.action, body.payload ?? {}, client);
          return Response.json(result ?? { ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "失败";
          const status = /unauthorized/i.test(message) ? 401 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
