/**
 * 把服务端返回的 base64 文件交给用户保存。
 * 浏览器里用 <a download>；Android 客户端在启动时注册 `__bwSaveFile`，
 * 改走系统“保存到…”（SAF），因为 WebView 不支持 blob 链接下载。
 * 返回 false 表示用户取消了保存。
 */
type NativeSaver = (fileName: string, mime: string, base64: string) => Promise<boolean>;

export async function saveBase64(fileName: string, base64: string, mime = "application/octet-stream"): Promise<boolean> {
  const native = (globalThis as { __bwSaveFile?: NativeSaver }).__bwSaveFile;
  if (native) return native(fileName, mime, base64);
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
