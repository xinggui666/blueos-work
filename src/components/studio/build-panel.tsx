/**
 * 交付面板里的 RPK 构建：发起构建（先保存到云端）、任务状态、日志、产物检查、取消、下载。
 * 积分规则：发起时预扣 1 个打包积分；成功才确认扣除；失败、取消、不可用都不扣。
 */
import { useCallback, useEffect, useState } from "react";
import { Download, Hammer, RefreshCw, X } from "lucide-react";
import { call, errorText } from "@/lib/platform/client";
import type { EditorProject } from "@/lib/protocol/editor";

type BuildCard = {
  id: string;
  revision: number;
  status: string;
  statusLabel: string;
  mode: string;
  versionName: string;
  quotaState: string;
  error: string;
  artifactName: string | null;
  artifactSha256: string | null;
  artifactBytes: number | null;
  toolkit: string;
  createdAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  message?: string;
};
type BuildDetail = BuildCard & { log: string; verify: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null };

const ACTIVE = new Set(["queued", "waiting", "running"]);
const QUOTA_TEXT: Record<string, string> = { none: "未扣分", reserved: "已预扣 1 分", committed: "已扣 1 分", released: "预扣已退回", waived: "管理员重试，不扣分" };

export function BuildPanel({ project }: { project: EditorProject }) {
  const [builds, setBuilds] = useState<BuildCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<BuildDetail | null>(null);

  const refresh = useCallback(() => {
    call<BuildCard[]>("listBuilds", { projectId: project.id })
      .then(setBuilds)
      .catch(() => undefined);
  }, [project.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 有进行中的任务时每 2 秒刷新一次状态。
  const active = builds.some((b) => ACTIVE.has(b.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  function start() {
    setBusy(true);
    setNote("");
    // 只构建云端已保存的修订，所以先保存当前编辑结果。
    void call("syncProject", { project })
      .then(() => call<BuildCard>("requestBuild", { projectId: project.id }))
      .then((card) => {
        setNote(card.message ?? card.statusLabel);
        refresh();
      })
      .catch((reason) => setNote(errorText(reason)))
      .finally(() => setBusy(false));
  }

  function download(build: BuildCard) {
    void call<{ fileName: string; rpkBase64: string }>("downloadBuild", { id: build.id })
      .then((file) => {
        const bytes = Uint8Array.from(atob(file.rpkBase64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = file.fileName;
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch((reason) => setNote(errorText(reason)));
  }

  return (
    <div>
      <p className="mt-5 text-sm font-semibold">RPK 成品</p>
      <p className="mt-1 text-sm leading-6 text-muted">
        服务器用 BlueOS 官方工具链编译当前云端修订。发起时预扣 1 个 RPK 打包积分，编译成功并通过产物检查才扣除；失败或取消会退回。还没有在真机上验证。
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={start}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-line text-sm font-medium disabled:opacity-60"
      >
        <Hammer className="size-4" />
        {busy ? "正在保存并提交…" : "构建 RPK"}
      </button>
      {note ? <p className="mt-2 text-sm leading-6 text-muted" data-testid="build-note">{note}</p> : null}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-muted">构建记录</p>
        <button type="button" onClick={refresh} className="inline-flex min-h-9 items-center gap-1 text-xs text-muted">
          <RefreshCw className="size-3.5" />
          刷新
        </button>
      </div>
      <ul className="mt-1 grid gap-2">
        {builds.length === 0 ? <li className="text-sm text-muted">还没有构建记录。</li> : null}
        {builds.slice(0, 10).map((b) => (
          <li key={b.id} className="rounded-md border border-line p-2 text-xs" data-testid="build-row">
            <div className="flex items-center justify-between gap-2">
              <span className={`font-medium ${b.status === "succeeded" ? "text-accent" : b.status === "failed" ? "text-warn" : ""}`}>
                {b.statusLabel}
                {b.cancelRequested && b.status === "running" ? "（正在取消）" : ""}
              </span>
              <span className="text-muted">
                {b.revision ? `修订 ${b.revision} · ` : ""}
                {b.mode === "release" ? "正式签名" : "调试包"} · {QUOTA_TEXT[b.quotaState] ?? b.quotaState}
              </span>
            </div>
            {b.error ? <p className="mt-1 leading-5 text-muted">{b.error}</p> : null}
            {b.artifactSha256 ? (
              <p className="mt-1 break-all font-mono text-muted">
                {b.artifactName} · {b.artifactBytes} 字节 · SHA-256 {b.artifactSha256}
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-2">
              {b.status === "succeeded" ? (
                <button type="button" onClick={() => download(b)} className="inline-flex min-h-9 items-center gap-1 rounded-md bg-accent px-2 text-accent-fg">
                  <Download className="size-3.5" />
                  下载 RPK
                </button>
              ) : null}
              {ACTIVE.has(b.status) && !b.cancelRequested ? (
                <button
                  type="button"
                  onClick={() => void call("cancelBuild", { id: b.id }).then(refresh).catch((reason) => setNote(errorText(reason)))}
                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-line px-2"
                >
                  <X className="size-3.5" />
                  取消
                </button>
              ) : null}
              {b.status !== "unavailable" ? (
                <button
                  type="button"
                  onClick={() =>
                    open?.id === b.id ? setOpen(null) : void call<BuildDetail>("getBuild", { id: b.id }).then(setOpen).catch((reason) => setNote(errorText(reason)))
                  }
                  className="min-h-9 rounded-md border border-line px-2"
                >
                  {open?.id === b.id ? "收起日志" : "日志与检查"}
                </button>
              ) : null}
            </div>
            {open?.id === b.id ? (
              <div className="mt-2">
                {open.verify ? (
                  <ul className="mb-2">
                    {open.verify.checks.map((c) => (
                      <li key={c.name} className={c.ok ? "text-muted" : "text-warn"}>
                        {c.ok ? "✔" : "✖"} {c.name} {c.detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono text-[11px] leading-4">{open.log || "（还没有日志）"}</pre>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
