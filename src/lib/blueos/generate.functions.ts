import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export const generateSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("无效的项目数据");
    if (JSON.stringify(input).length > 400_000) throw new Error("项目过大");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { dispatch } = await import("../platform/logic.server");
    return (await dispatch(context.userId, "generate", { dsl: data })) as {
      ok: boolean;
      issues?: { path: string; message: string; level: "error" | "warn" }[];
      fileName?: string;
      sha256?: string;
      zipBase64?: string | null;
      files?: { path: string; text?: string; bytes: number }[];
      notes?: string[];
      compiled?: false;
      jobId?: string;
    };
  });
