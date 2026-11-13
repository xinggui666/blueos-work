import { useEffect, useState } from "react";
import { call, errorText, useMe } from "@/lib/platform/client";

type Submission = { id: string; name: string; slug: string; status: string; reviewNote: string; createdAt: string };

const STATUS: Record<string, string> = { pending: "待审核", changes: "待修改", approved: "已通过", rejected: "已拒绝" };

export function DeveloperView() {
  const { data, reload } = useMe<{ developerStatus: string }>();
  const [rows, setRows] = useState<Submission[]>([]);
  const [note, setNote] = useState("");
  const [form, setForm] = useState({
    name: "",
    slug: "",
    category: "装饰",
    summary: "",
    version: "1.0.0",
    schemaText: '{\n  "type": "catalog-only",\n  "fields": []\n}',
  });

  function load() {
    void call<Submission[]>("mySubmissions").then(setRows).catch((reason) => setNote(errorText(reason)));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">开发者投稿</h1>
      <p className="mt-2 text-sm leading-6 text-muted">投稿通过后进入商城目录。它不会获得新的画布映射，也不会携带脚本。自动上架只是免去等待，机器检查仍然会跑。</p>
      <p className="mt-3 text-sm">当前资格：{data?.developerStatus === "approved" ? "已通过" : data?.developerStatus === "pending" ? "审核中" : data?.developerStatus === "suspended" ? "已暂停" : "未申请"}</p>
      {data && data.developerStatus !== "approved" ? (
        <button
          type="button"
          className="mt-3 min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg"
          onClick={() => {
            void call("developerApply")
              .then(() => {
                setNote("已提交开发者申请");
                reload();
              })
              .catch((reason) => setNote(errorText(reason)));
          }}
        >
          申请开发者
        </button>
      ) : null}
      {data?.developerStatus === "approved" ? (
        <form
          className="mt-5 rounded-xl border border-line bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void call("submitComponent", form)
              .then(() => {
                setNote("投稿已提交");
                load();
              })
              .catch((reason) => setNote(errorText(reason)));
          }}
        >
          <label className="block text-sm text-muted">名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg" /></label>
          <label className="mt-3 block text-sm text-muted">标识<input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg" /></label>
          <label className="mt-3 block text-sm text-muted">
            分类
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg">
              {["基础", "布局", "图形", "数据", "交互", "装饰"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm text-muted">说明<textarea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} className="mt-1 min-h-24 w-full rounded-md border border-line bg-bg px-3 py-2 text-fg" /></label>
          <label className="mt-3 block text-sm text-muted">版本<input value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg" /></label>
          <label className="mt-3 block text-sm text-muted">Schema<textarea value={form.schemaText} onChange={(event) => setForm({ ...form, schemaText: event.target.value })} className="mt-1 min-h-32 w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs text-fg" /></label>
          <button type="submit" className="mt-4 min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg">提交审核</button>
        </form>
      ) : null}
      {note ? <p className="mt-4 text-sm text-muted">{note}</p> : null}
      <ul className="mt-6">
        {rows.map((row) => (
          <li key={row.id} className="mt-2 rounded-md border border-line px-3 py-3 text-sm">
            <span className="font-medium">{row.name}</span>
            <span className="ml-2 font-mono text-xs text-muted">{row.slug}</span>
            <span className="mt-1 block text-muted">{STATUS[row.status] ?? row.status}{row.reviewNote ? ` · ${row.reviewNote}` : ""}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
