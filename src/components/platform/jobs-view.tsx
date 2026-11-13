import { useEffect, useState } from "react";
import { call, errorText } from "@/lib/platform/client";
import { saveBase64 } from "@/lib/platform/save-file";

type Job = { id: string; projectId: string; kind: string; status: string; message: string; fileName: string | null; sha256: string | null; exported: boolean; createdAt: string };

const KIND: Record<string, string> = { generation: "历史源工程", build: "RPK", export: "工程包" };
const STATUS: Record<string, string> = { succeeded: "已完成", failed: "失败", unavailable: "未执行" };

export function JobsView() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState("");

  function load() {
    call<Job[]>("listJobs").then(setJobs).catch((reason) => setError(errorText(reason)));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">生成和构建任务</h1>
      <p className="mt-2 text-sm leading-6 text-muted">成功的生成任务产物是 source_zip。状态为未执行的构建没有调用官方编译器，不能当成构建成功。</p>
      {error ? <p className="mt-4 text-sm text-warn">{error}</p> : null}
      {!jobs ? <p className="mt-6 text-sm text-muted">正在读取任务…</p> : null}
      <ul className="mt-4">
        {jobs?.length === 0 ? <li className="text-sm text-muted">还没有任务。</li> : null}
        {jobs?.map((job) => (
          <li key={job.id} className="mt-3 rounded-xl border border-line bg-surface p-4">
            <p className="text-sm font-semibold">{KIND[job.kind] ?? job.kind} · {STATUS[job.status] ?? job.status}</p>
            <p className="mt-1 text-sm leading-6 text-muted">{job.message}</p>
            {job.sha256 ? <p className="mt-2 break-all font-mono text-xs text-muted">{job.sha256}</p> : null}
            {job.kind === "generation" && job.status === "succeeded" ? (
              <button
                type="button"
                className="mt-3 min-h-11 rounded-md border border-line px-3 text-sm"
                onClick={() => {
                  setError("");
                  void call<{ fileName: string; zipBase64: string }>("downloadJob", { id: job.id })
                    .then((file) => saveBase64(file.fileName, file.zipBase64, "application/zip"))
                    .then(() => load())
                    .catch((reason) => setError(errorText(reason)));
                }}
              >
                下载源工程{job.exported ? "" : "（扣导出额度）"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
