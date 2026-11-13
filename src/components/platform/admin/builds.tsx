import { useEffect, useState } from "react";
import { call, errorText } from "@/lib/platform/client";
import { Card } from "./ui";
import { STATUS_TEXT, act, bytes, download, field, ghost, useAdmin, when } from "./lib";

type Task = {
  id: string;
  projectId: string;
  status: string;
  mode: string;
  packageName: string;
  versionName: string;
  revision: number;
  toolkit: string;
  quotaState: string;
  quotaLabel: string;
  error: string;
  artifactName: string | null;
  artifactSha256: string | null;
  artifactBytes: number | null;
  createdAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  retryOf: string | null;
  userId: string;
  email: string;
};
type Board = {
  tasks: Task[];
  counts: Record<string, number>;
  workers: { id: string; host: string; toolkit: string; sandbox: string; signing: boolean; online: boolean; seenAt: string | null }[];
  failureReasons: { reason: string; count: number }[];
};
type Detail = Task & {
  log: string;
  verify: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null;
  environment: Record<string, unknown>;
  generator: string;
  runtimeSha256: string;
  workerId: string | null;
  retriedBy: string | null;
  ledger: { phase: string; delta: number; note: string; createdAt: string | null }[];
  retries: Task[];
};
const ACTIVE = ["queued", "waiting", "running"];

export function BuildsTab({ onError }: { onError: (t: string) => void }) {
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [board, reload] = useAdmin<Board>("adminBuilds", { status, query }, onError);
  const [detail, setDetail] = useState<Detail | null>(null);
  const open = (id: string) =>
    call<Detail>("adminBuild", { id })
      .then(setDetail)
      .catch((reason) => onError(errorText(reason)));
  const busy = board?.tasks.some((t) => ACTIVE.includes(t.status));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [busy, reload]);
  const refresh = (id?: string) => () => {
    reload();
    if (id) void open(id);
  };
  if (!board) return null;
  return (
    <div className="mt-5 grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <p className="font-medium">队列</p>
          <p className="mt-1 text-muted">
            {["queued", "waiting", "running", "succeeded", "failed", "cancelled", "unavailable"].map((s) => `${STATUS_TEXT[s]} ${board.counts[s] ?? 0}`).join(" · ")}
          </p>
          <p className="mt-2 font-medium">失败原因</p>
          <ul className="text-muted">
            {board.failureReasons.map((r) => (
              <li key={r.reason}>
                {r.count} 次 · {r.reason}
              </li>
            ))}
            {!board.failureReasons.length ? <li>没有失败</li> : null}
          </ul>
        </Card>
        <Card>
          <p className="font-medium">构建 Worker / SDK 版本</p>
          <ul className="mt-1 text-muted">
            {board.workers.map((w) => (
              <li key={w.id}>
                {w.online ? "🟢" : "⚪"} {w.id} · {w.toolkit || "未知工具链"} · 沙箱 {w.sandbox} · {w.signing ? "正式签名" : "仅调试包"} · 最近心跳 {when(w.seenAt)}
              </li>
            ))}
            {!board.workers.length ? <li>没有 Worker 上线过。RPK 构建会显示“不可用”，不扣分。</li> : null}
          </ul>
        </Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="构建状态" value={status} onChange={(e) => setStatus(e.target.value)} className="min-h-11 rounded-md border border-line bg-bg px-2 text-sm">
          <option value="">全部状态</option>
          {Object.keys(STATUS_TEXT)
            .slice(0, 7)
            .map((s) => (
              <option key={s} value={s}>
                {STATUS_TEXT[s]}
              </option>
            ))}
        </select>
        <input aria-label="搜索构建" placeholder="任务/工程编号、包名、邮箱" value={query} onChange={(e) => setQuery(e.target.value)} className={`${field} mt-0 max-w-sm`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ul className="grid content-start gap-2">
          {board.tasks.map((t) => (
            <li key={t.id}>
              <button type="button" data-testid="admin-build-row" onClick={() => void open(t.id)} className={`w-full rounded-xl border bg-surface p-3 text-left text-sm ${detail?.id === t.id ? "border-accent" : "border-line"}`}>
                <span className="font-medium">{STATUS_TEXT[t.status] ?? t.status}</span>
                <span className="text-muted">
                  {" "}
                  · {t.email} · {t.packageName || t.projectId} {t.versionName} · {t.mode === "release" ? "正式" : "调试"} · {t.quotaLabel}
                  {t.retryOf ? " · 管理员重试" : ""}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {when(t.createdAt)}
                  {t.error ? ` · ${t.error}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {detail ? (
          <Card>
            <p className="text-base font-semibold">
              {STATUS_TEXT[detail.status] ?? detail.status} · {detail.packageName} {detail.versionName}（修订 {detail.revision}）
            </p>
            <p className="mt-1 break-all text-muted">
              任务 {detail.id} · 用户 {detail.email || detail.userId} · 工具链 {detail.toolkit || "—"} · 生成器 {detail.generator} · Worker {detail.workerId ?? "—"}
            </p>
            <p className="mt-1 text-muted">
              积分：{detail.quotaLabel}
              {detail.ledger.map((l) => ` · ${l.phase} ${l.delta}`).join("")}
            </p>
            {detail.retriedBy ? <p className="mt-1 text-muted">由管理员 {detail.retriedBy} 重试（原任务 {detail.retryOf}），不扣用户积分。</p> : null}
            {detail.error ? <p className="mt-1 text-warn">{detail.error}</p> : null}
            {detail.artifactSha256 ? (
              <p className="mt-1 break-all font-mono text-xs text-muted">
                {detail.artifactName} · {bytes(detail.artifactBytes ?? 0)} · SHA-256 {detail.artifactSha256}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {ACTIVE.includes(detail.status) && !detail.cancelRequested ? (
                <button type="button" className={ghost} onClick={() => act(onError, "adminCancelBuild", { id: detail.id }, refresh(detail.id))}>
                  取消任务
                </button>
              ) : null}
              {["failed", "cancelled"].includes(detail.status) ? (
                <button type="button" className={ghost} onClick={() => act(onError, "adminRetryBuild", { id: detail.id }, refresh(detail.id))}>
                  重试（不扣用户积分）
                </button>
              ) : null}
              {detail.status === "succeeded" ? (
                <button
                  type="button"
                  className={ghost}
                  onClick={() =>
                    call<{ fileName: string; rpkBase64: string }>("adminDownloadBuild", { id: detail.id })
                      .then((r) => download(r.fileName, Uint8Array.from(atob(r.rpkBase64), (ch) => ch.charCodeAt(0))))
                      .catch((reason) => onError(errorText(reason)))
                  }
                >
                  下载产物
                </button>
              ) : null}
            </div>
            {detail.retries.length ? (
              <p className="mt-2 text-muted">
                重试：
                {detail.retries.map((r) => (
                  <button key={r.id} type="button" className="ml-2 underline" onClick={() => void open(r.id)}>
                    {STATUS_TEXT[r.status] ?? r.status}
                  </button>
                ))}
              </p>
            ) : null}
            {detail.verify ? (
              <ul className="mt-2">
                {detail.verify.checks.map((c) => (
                  <li key={c.name} className={c.ok ? "text-muted" : "text-warn"}>
                    {c.ok ? "✔" : "✖"} {c.name} {c.detail}
                  </li>
                ))}
              </ul>
            ) : null}
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono text-[11px]">{detail.log || "（没有日志）"}</pre>
            <p className="mt-2 break-all text-xs text-muted">环境：{JSON.stringify(detail.environment)}</p>
          </Card>
        ) : (
          <p className="text-sm text-muted">选择任务查看日志、检查结果和积分结算。</p>
        )}
      </div>
    </div>
  );
}
