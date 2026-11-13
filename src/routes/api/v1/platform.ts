import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { isClient } from "@/lib/contract/surface";
import { statusOf } from "@/lib/platform/errors";

/** 请求体上限。工程本身限制 400KB，这里留出 JSON 包装和修订快照的余量。 */
const MAX_BODY_BYTES = 1_000_000;

export const Route = createFileRoute("/api/v1/platform")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declared = Number(request.headers.get("content-length") || 0);
        if (declared > MAX_BODY_BYTES) return Response.json({ error: "请求过大" }, { status: 413 });
        const header = request.headers.get("authorization") || "";
        const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        try {
          const userId = await requireUserId(token || undefined);
          const raw = await request.text();
          if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return Response.json({ error: "请求过大" }, { status: 413 });
          let body: { action?: unknown; payload?: unknown; client?: unknown };
          try {
            body = JSON.parse(raw) as typeof body;
          } catch {
            return Response.json({ error: "请求不是合法 JSON" }, { status: 400 });
          }
          if (!body || typeof body !== "object" || typeof body.action !== "string" || !/^[a-zA-Z]{2,40}$/.test(body.action)) {
            return Response.json({ error: "无效请求" }, { status: 400 });
          }
          if (body.client !== undefined && !isClient(body.client)) return Response.json({ error: "未知客户端" }, { status: 400 });
          const client = isClient(body.client) ? body.client : "android";
          const { dispatch } = await import("@/lib/platform/logic.server");
          const result = await dispatch(userId, body.action, body.payload ?? {}, client);
          return Response.json(result ?? { ok: true });
        } catch (error) {
          const status = statusOf(error);
          if (!(error instanceof Error)) console.error("[api/v1/platform]", error);
          const message = status === 401 ? "Unauthorized" : error instanceof Error ? error.message : "失败";
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
