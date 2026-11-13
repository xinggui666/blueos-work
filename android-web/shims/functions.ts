/** Android 版替换 src/lib/platform/functions.ts：不走 TanStack 服务端函数，改由原生发出 HTTP 请求。 */
import { platformCall } from "../bridge";

export function platform(input: { data: { action: string; payload: unknown; client: string } }): Promise<unknown> {
  return platformCall(input.data.action, input.data.payload);
}
