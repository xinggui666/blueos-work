import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { isClient } from "@/lib/contract/surface";
import { ApiError, statusOf } from "@/lib/platform/errors";

import {
  BINARY_REQUEST_BYTES,
  NORMAL_REQUEST_BYTES,
  boundedRequestText,
  requestLimit,
} from "@/lib/platform/request-limits";

export const Route = createFileRoute("/api/v1/platform")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declared = Number(request.headers.get("content-length") || 0);
        if (declared > BINARY_REQUEST_BYTES) return Response.json({ error: "请求过大" }, { status: 413 });
        const header = request.headers.get("authorization") || "";
        const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        try {
          const userId = await requireUserId(token || undefined);
          let raw: string;
          try {
            raw = await boundedRequestText(request);
          } catch {
            return Response.json({ error: "请求过大或编码无效" }, { status: 413 });
          }
          const rawBytes = Buffer.byteLength(raw);
          let body: { action?: unknown; payload?: unknown; client?: unknown };
          try {
            body = JSON.parse(raw) as typeof body;
          } catch {
            return Response.json({ error: rawBytes > NORMAL_REQUEST_BYTES ? "请求过大" : "请求不是合法 JSON" }, { status: rawBytes > NORMAL_REQUEST_BYTES ? 413 : 400 });
          }
          if (rawBytes > requestLimit(body && body.action))
            return Response.json({ error: "请求过大" }, { status: 413 });
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
          const data = error instanceof ApiError && error.data ? error.data : {};
          return Response.json({ ...data, error: message }, { status });
        }
      },
    },
  },
});
