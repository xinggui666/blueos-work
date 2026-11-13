/** 管理后台共用的样式、格式化和接口调用帮助函数。 */
import { useCallback, useEffect, useState } from "react";
import { call, errorText } from "@/lib/platform/client";

export const field = "mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-sm text-fg";
export const ghost = "min-h-11 rounded-md border border-line px-3 text-sm disabled:opacity-50";
export const primary = "min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-50";

export function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 加载接口数据：返回 [数据, 重新加载]；出错时交给 onError。 */
export function useAdmin<T>(action: string, payload: unknown, onError: (text: string) => void): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const key = JSON.stringify(payload ?? {});
  const load = useCallback(() => {
    call<T>(action, JSON.parse(key))
      .then(setData)
      .catch((reason) => onError(errorText(reason)));
  }, [action, key, onError]);
  useEffect(load, [load]);
  return [data, load];
}

/** 执行一个写操作：成功后回调（一般是重新加载），失败把消息交给 onError。 */
export function act(onError: (text: string) => void, action: string, payload: unknown, then?: (result: unknown) => void) {
  call(action, payload)
    .then((result) => then?.(result))
    .catch((reason) => onError(errorText(reason)));
}

export function download(fileName: string, data: BlobPart, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export const STATUS_TEXT: Record<string, string> = {
  queued: "待排队",
  waiting: "等待执行",
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  unavailable: "不可用",
  pending: "待确认",
  confirmed: "已开通",
  refunded: "已撤销",
  unused: "未使用",
  used: "已使用",
  frozen: "已冻结",
  void: "已作废",
  expired: "已过期",
  active: "正常",
  banned: "已封禁",
};

export const ACCESS: Record<string, string> = {
  public_free: "免费",
  membership: "会员",
  license_key: "卡密解锁",
  specific_user: "指定用户",
  internal: "内部",
  disabled: "停用",
};
