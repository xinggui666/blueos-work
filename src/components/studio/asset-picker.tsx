import { useState } from "react";
import { call, errorText } from "@/lib/platform/client";
import { workspace, isCurrent } from "@/lib/platform/workspace";
import { toNative } from "@/lib/protocol/editor";
import type { AssetDoc } from "@/lib/protocol/schema";
import type { Project, SceneNode } from "@/lib/blueos/model";
import { useStudio } from "@/lib/blueos/store";
export function AssetPicker({
  project,
  pageId,
  node,
}: {
  project: Project;
  pageId: string;
  node: SceneNode;
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const assets = project.protocolExtras?.assets ?? [];
  const select = (asset: AssetDoc) =>
    useStudio
      .getState()
      .patchNode(project.id, pageId, node.id, { props: { src: `/${asset.path}` } });
  return (
    <section className="mt-3 rounded-md border border-line p-3" aria-label="图片资源">
      <p className="text-sm font-semibold">图片资源（PNG）</p>
      <p className="text-xs text-muted">
        在线上传；仅 8 位非交错 PNG、单张 ≤2MiB、≤1048576 像素。普通账号资源空间
        20MiB，会员以授权快照为准。未选择新图片前保留旧引用；不支持网络图片、SVG、字体或音频。
      </p>
      <label className="mt-2 block text-sm">
        上传 PNG
        <input
          aria-label="上传 PNG 资源"
          type="file"
          accept="image/png,.png"
          disabled={busy}
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            const scope = workspace();
            setBusy(true);
            setMessage("");
            try {
              if (!scope || file.size > 2 * 1024 * 1024)
                throw new Error("请登录，文件不得超过 2MiB");
              const bytes = new Uint8Array(await file.arrayBuffer());
              let binary = "";
              for (let p = 0; p < bytes.length; p += 32768)
                binary += String.fromCharCode(...bytes.subarray(p, p + 32768));
              if (!isCurrent(scope)) throw new Error("账号或服务器已切换，取消上传");
              const result = await call<{ asset: AssetDoc }>("uploadAsset", {
                mime: file.type || "image/png",
                fileBase64: btoa(binary),
              });
              if (!isCurrent(scope)) throw new Error("账号或服务器已切换，未修改工程");
              useStudio.getState().updateProject(project.id, (current) => {
                const next = toNative(current);
                return {
                  ...next,
                  protocolExtras: {
                    ...next.protocolExtras!,
                    assets: [
                      ...next.protocolExtras!.assets.filter((a) => a.path !== result.asset.path),
                      result.asset,
                    ],
                  },
                  pages: next.pages.map((page) =>
                    page.id === pageId
                      ? {
                          ...page,
                          nodes: page.nodes.map((item) =>
                            item.id === node.id
                              ? { ...item, props: { ...item.props, src: `/${result.asset.path}` } }
                              : item,
                          ),
                        }
                      : page,
                  ),
                };
              });
              setMessage(
                "PNG 已上传并引用；云端同步成功后才可导出/构建。资源字节目前不跨重启离线缓存。",
              );
            } catch (error) {
              setMessage(errorText(error));
            } finally {
              if (isCurrent(scope)) setBusy(false);
            }
          }}
        />
      </label>
      <label className="mt-2 block text-sm">
        选择已有资源
        <select
          aria-label="选择图片资源"
          className="mt-1 w-full rounded border border-line bg-bg"
          value={String(node.props.src ?? "")}
          onChange={(event) => {
            const asset = assets.find((a) => `/${a.path}` === event.target.value);
            if (asset) select(asset);
          }}
        >
          <option value={String(node.props.src ?? "")}>{String(node.props.src ?? "未选择")}</option>
          {assets
            .filter((a) => a.kind === "image" && `/${a.path}` !== node.props.src)
            .map((a) => (
              <option key={a.path} value={`/${a.path}`}>
                {a.path} ({a.bytes} 字节)
              </option>
            ))}
        </select>
      </label>
      {message && (
        <p role="status" className="mt-2 break-all text-xs">
          {message}
        </p>
      )}
    </section>
  );
}
