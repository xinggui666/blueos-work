import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { isClient, type ClientKind } from "@/lib/contract/surface";

export const platform = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("无效请求");
    const action = (input as { action?: unknown }).action;
    const payload = (input as { payload?: unknown }).payload ?? {};
    const client = (input as { client?: unknown }).client ?? "web";
    if (typeof action !== "string" || !/^[a-zA-Z]{2,40}$/.test(action)) throw new Error("无效请求");
    if (!isClient(client)) throw new Error("未知客户端");
    if (JSON.stringify(payload).length > 500_000) throw new Error("请求过大");
    return { action, payload, client: client as ClientKind };
  })
  .handler(async ({ data, context }) => {
    const { dispatch } = await import("./logic.server");
    return (await dispatch(context.userId, data.action, data.payload, data.client)) as Record<string, string | number | boolean | null>;
  });