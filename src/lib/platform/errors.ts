/** 带 HTTP 状态码的业务错误。消息直接给用户看，不要放内部细节。 */
export type ApiStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503;

export class ApiError extends Error {
  readonly status: ApiStatus;
  /** 随错误一起返回给客户端的结构化数据（例如冲突时的服务端版本）。 */
  readonly data?: Record<string, unknown>;
  constructor(status: ApiStatus, message: string, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = "ApiError";
  }
}

export const forbidden = (message = "没有权限") => new ApiError(403, message);
export const notFound = (message: string) => new ApiError(404, message);
export const conflict = (message: string) => new ApiError(409, message);

/** 把任意错误映射成 HTTP 状态码。未分类的业务错误按 400 处理。 */
export function statusOf(error: unknown): number {
  if (error instanceof ApiError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  if (error instanceof Error && /^unauthorized$/i.test(error.message)) return 401;
  return 400;
}
