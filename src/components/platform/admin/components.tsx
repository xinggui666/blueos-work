import { useState } from "react";
import { call, errorText } from "@/lib/platform/client";
import { Card } from "./ui";
import { act, bytes, download, field, ghost, primary, useAdmin, when, ACCESS } from "./lib";

type Row = { id: string; name: string; slug: string; code?: string; access: string; status: string; latestVersion: string };
type Detail = {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  access: string;
  minPlan: string;
  status: string;
  latestVersion: string;
  sdkMin: string;
  sdkMax: string;
  dependencies: string[];
  installs: number;
  versions: { id: string; version: string; changelog: string; sdkMin: string; active: boolean; createdAt: string | null }[];
  assets: { id: string; name: string; mime: string; bytes: number; sha256: string; createdAt: string | null }[];
};

export function ComponentsTab({ onError }: { onError: (t: string) => void }) {
  const [rows, reload] = useAdmin<Row[]>("adminComponents", {}, onError);
  const [selected, setSelected] = useState("");
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <ul className="grid content-start gap-2">
        {(rows ?? []).map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setSelected(c.id)} className={`w-full rounded-xl border bg-surface p-3 text-left text-sm ${selected === c.id ? "border-accent" : "border-line"}`}>
              <span className="block font-medium">
                {c.code ? `${c.code} · ` : ""}
                {c.name} <span className="font-mono text-xs text-muted">{c.slug}</span>
              </span>
              <span className="mt-1 block text-xs text-muted">
                {ACCESS[c.access] ?? c.access} · {c.status === "published" ? "已上架" : "已下架"} · v{c.latestVersion}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected ? <ComponentDetail key={selected} id={selected} onError={onError} onChanged={reload} /> : <p className="text-sm text-muted">选择左侧组件编辑。</p>}
    </div>
  );
}

function ComponentDetail({ id, onError, onChanged }: { id: string; onError: (t: string) => void; onChanged: () => void }) {
  const [d, reload] = useAdmin<Detail>("adminComponent", { id }, onError);
  const [form, setForm] = useState<Partial<Detail> & { deps?: string }>({});
  const [version, setVersion] = useState({ version: "", changelog: "", sdkMin: "" });
  const [saved, setSaved] = useState("");
  if (!d) return null;
  const v = { ...d, deps: d.dependencies.join(", "), ...form };
  const done = () => {
    reload();
    onChanged();
  };
  const set = (patch: Partial<Detail> & { deps?: string }) => setForm({ ...form, ...patch });
  return (
    <div className="grid gap-3" data-testid="component-detail">
      <Card>
        <p className="text-base font-semibold">
          {d.name} <span className="font-mono text-xs text-muted">{d.slug}</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          {d.installs} 人已添加 · 当前版本 v{d.latestVersion}
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-muted">
            名称
            <input value={v.name} onChange={(e) => set({ name: e.target.value })} className={field} />
          </label>
          <label className="text-muted">
            分类
            <input value={v.category} onChange={(e) => set({ category: e.target.value })} className={field} />
          </label>
          <label className="text-muted">
            授权
            <select value={v.access} onChange={(e) => set({ access: e.target.value })} className={field}>
              {Object.entries(ACCESS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-muted">
            上下架
            <select value={v.status} onChange={(e) => set({ status: e.target.value })} className={field}>
              <option value="published">上架</option>
              <option value="unpublished">下架</option>
            </select>
          </label>
          <label className="text-muted">
            最低 SDK
            <input value={v.sdkMin} onChange={(e) => set({ sdkMin: e.target.value })} placeholder="例如 1.0" className={field} />
          </label>
          <label className="text-muted">
            最高 SDK
            <input value={v.sdkMax} onChange={(e) => set({ sdkMax: e.target.value })} placeholder="留空表示不限" className={field} />
          </label>
          <label className="text-muted sm:col-span-2">
            依赖组件（标识，逗号分隔）
            <input value={v.deps} onChange={(e) => set({ deps: e.target.value })} className={field} />
          </label>
          <label className="text-muted sm:col-span-2">
            简介
            <input value={v.summary} onChange={(e) => set({ summary: e.target.value })} className={field} />
          </label>
          <label className="text-muted sm:col-span-2">
            详细说明
            <textarea value={v.description} onChange={(e) => set({ description: e.target.value })} className={`${field} min-h-24 py-2`} />
          </label>
        </div>
        <button
          type="button"
          className={`${primary} mt-3`}
          onClick={() =>
            act(
              onError,
              "adminSaveComponent",
              {
                id,
                name: v.name,
                category: v.category,
                access: v.access,
                status: v.status,
                sdkMin: v.sdkMin,
                sdkMax: v.sdkMax,
                summary: v.summary,
                description: v.description,
                dependencies: (v.deps ?? "")
                  .split(/[,，\s]+/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
              () => {
                setForm({});
                setSaved("已保存");
                done();
              },
            )
          }
        >
          保存组件
        </button>
        {saved ? <span className="ml-2 text-muted">{saved}</span> : null}
      </Card>

      <Card>
        <p className="font-medium">版本</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input aria-label="新版本号" placeholder="新版本号 x.y.z" value={version.version} onChange={(e) => setVersion({ ...version, version: e.target.value })} className={field} />
          <input aria-label="版本最低 SDK" placeholder="最低 SDK" value={version.sdkMin} onChange={(e) => setVersion({ ...version, sdkMin: e.target.value })} className={field} />
          <input aria-label="更新说明" placeholder="更新说明" value={version.changelog} onChange={(e) => setVersion({ ...version, changelog: e.target.value })} className={field} />
        </div>
        <button
          type="button"
          className={`${ghost} mt-2`}
          onClick={() =>
            act(onError, "adminAddComponentVersion", { id, ...version }, () => {
              setVersion({ version: "", changelog: "", sdkMin: "" });
              done();
            })
          }
        >
          发布新版本
        </button>
        <ul className="mt-2">
          {d.versions.map((x) => (
            <li key={x.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 text-muted">
              <span>
                v{x.version}
                {x.sdkMin ? ` · SDK ≥ ${x.sdkMin}` : ""} · {x.changelog || "无说明"} · {when(x.createdAt)}
                {x.active ? "" : " · 已停用"}
              </span>
              <button type="button" className={ghost} onClick={() => act(onError, "adminSetComponentVersion", { versionId: x.id, active: !x.active }, done)}>
                {x.active ? "停用" : "启用"}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <p className="font-medium">资源（PNG / JPEG / WebP，单个 ≤ 256 KB）</p>
        <input
          type="file"
          aria-label="上传资源"
          accept="image/png,image/jpeg,image/webp"
          className="mt-2 text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void file.arrayBuffer().then((buf) => {
              let bin = "";
              new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
              act(onError, "adminUploadAsset", { id, name: file.name, dataBase64: btoa(bin) }, done);
            });
          }}
        />
        <ul className="mt-2">
          {d.assets.map((a) => (
            <li key={a.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 text-muted">
              <span>
                {a.name} · {a.mime} · {bytes(a.bytes)} · <span className="font-mono text-xs">{a.sha256.slice(0, 12)}</span>
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={ghost}
                  onClick={() =>
                    call<{ name: string; mime: string; dataBase64: string }>("adminAsset", { assetId: a.id })
                      .then((r) => download(r.name, Uint8Array.from(atob(r.dataBase64), (ch) => ch.charCodeAt(0)), r.mime))
                      .catch((reason) => onError(errorText(reason)))
                  }
                >
                  下载
                </button>
                <button type="button" className={ghost} onClick={() => act(onError, "adminDeleteAsset", { assetId: a.id }, done)}>
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function SubmissionsTab({ onError }: { onError: (t: string) => void }) {
  const [rows, reload] = useAdmin<{ id: string; name: string; slug: string; status: string; summary: string; reviewNote: string; checks: { issues?: string[] } }[]>("adminSubmissions", {}, onError);
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <ul className="mt-5 grid gap-3">
      {(rows ?? []).map((s) => (
        <li key={s.id}>
          <Card>
            <p className="font-medium">
              {s.name} · {s.status} <span className="font-mono text-xs text-muted">{s.slug}</span>
            </p>
            <p className="mt-1 text-muted">{s.summary}</p>
            {s.checks?.issues?.length ? <p className="mt-1 text-warn">机器检查：{s.checks.issues.join("；")}</p> : <p className="mt-1 text-xs text-muted">机器检查通过</p>}
            {s.reviewNote ? <p className="mt-1 text-muted">审核意见：{s.reviewNote}</p> : null}
            <input aria-label="审核意见" placeholder="审核意见" value={notes[s.id] ?? ""} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} className={field} />
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ["approve", "通过并上架"],
                  ["changes", "退回修改"],
                  ["reject", "拒绝"],
                ] as const
              ).map(([decision, label]) => (
                <button key={decision} type="button" className={ghost} onClick={() => act(onError, "adminReview", { id: s.id, decision, note: notes[s.id] ?? "" }, reload)}>
                  {label}
                </button>
              ))}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
