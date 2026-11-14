import { useEffect, useState } from "react";
import { call } from "@/lib/platform/client";
import { workspace, isCurrent, type Workspace } from "@/lib/platform/workspace";
/** No URL is fetched: source path must be a content digest, response must pass server ACL. No persistent cache. */
export function AssetImage({ src, fit }: { src: string; fit: unknown }) {
  const scope = workspace();
  const [image, setImage] = useState<{ scope: Workspace; src: string; url: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setError("");
    const match = /^\/assets\/([0-9a-f]{64})\.png$/.exec(src);
    if (!scope || !match) return;
    void call<{ fileBase64: string }>("getAsset", { sha256: match[1] })
      .then((result) => {
        if (!cancelled && isCurrent(scope))
          setImage({ scope, src, url: `data:image/png;base64,${result.fileBase64}` });
      })
      .catch(() => {
        if (!cancelled && isCurrent(scope)) setError("资源不可用（离线/无权限/缺失）");
      });
    return () => {
      cancelled = true;
    };
  }, [scope, src]);
  if (image?.scope === scope && image?.src === src)
    return (
      <img
        alt="工程 PNG 资源"
        draggable={false}
        src={image.url}
        className="h-full w-full"
        style={{ objectFit: fit === "contain" || fit === "fill" ? fit : "cover" }}
      />
    );
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-2 px-1 text-center text-xs text-muted">
      {error || src.split("/").pop() || "未选择图片"}
    </div>
  );
}
