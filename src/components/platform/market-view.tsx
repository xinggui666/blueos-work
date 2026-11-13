import { useEffect, useState } from "react";
import { call, errorText } from "@/lib/platform/client";

type Item = {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  authorName: string;
  access: string;
  status: string;
  latestVersion: string;
  code?: string;
  installed: boolean;
};

const ACCESS: Record<string, string> = {
  public_free: "免费",
  membership: "会员",
  license_key: "卡密",
  specific_user: "指定用户",
  internal: "内部",
  disabled: "停用",
};

export function MarketView() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  function load() {
    call<Item[]>("market")
      .then(setItems)
      .catch((reason) => setError(errorText(reason)));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-xl font-semibold">组件商城</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
        目录里的官方组件对应画布上的类型。安装只是账号授权，不会下载可执行包。开发者投稿上架后也只是目录条目，不会变成新的 BlueOS 标签。
      </p>
      {error ? <p className="mt-4 text-sm text-warn">{error}</p> : null}
      {note ? <p className="mt-4 text-sm text-muted">{note}</p> : null}
      {!items ? <p className="mt-6 text-sm text-muted">正在读取目录…</p> : null}
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {items?.map((item) => (
          <li key={item.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{item.name}</h2>
                <p className="mt-1 font-mono text-xs text-muted">{item.code || item.slug} · {item.latestVersion}</p>
              </div>
              <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">{ACCESS[item.access] ?? item.access}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">{item.summary}</p>
            <p className="mt-2 text-xs text-muted">{item.category} · {item.authorName}</p>
            <button
              type="button"
              className="mt-4 min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-60"
              disabled={item.installed}
              onClick={() => {
                setNote("");
                void call("install", { componentId: item.id })
                  .then(() => {
                    setNote(`${item.name} 已记到我的组件`);
                    load();
                  })
                  .catch((reason) => setNote(errorText(reason)));
              }}
            >
              {item.installed ? "已安装" : "安装"}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
