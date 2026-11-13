import { Link, useNavigate } from "@tanstack/react-router";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { WatchFace } from "@/components/studio/face";
import { readBproj } from "@/lib/blueos/bproj";
import type { DeviceShape, TemplateId } from "@/lib/blueos/model";
import { useStudio, useStudioHydrated } from "@/lib/blueos/store";
import { useCloud } from "@/lib/platform/client";

const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const TEMPLATES: { id: TemplateId; label: string; detail: string }[] = [
  { id: "blank", label: "空白应用", detail: "一个首页，自己摆" },
  { id: "tabs", label: "底部导航", detail: "三页，可跳转可返回" },
  { id: "settings", label: "设置中心", detail: "开关和提示" },
  { id: "data", label: "数据展示", detail: "数字需会员，生成时核对" },
];

export function HomeView() {
  const hydrated = useStudioHydrated();
  const cloud = useCloud();
  const projects = useStudio((state) => state.projects);
  const createProject = useStudio((state) => state.createProject);
  const importProject = useStudio((state) => state.importProject);
  const duplicateProject = useStudio((state) => state.duplicateProject);
  const removeProject = useStudio((state) => state.removeProject);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ name: "新应用", appName: "新应用", packageName: "com.example.app", device: "watch-round" as DeviceShape, template: "tabs" as TemplateId });
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = projects.filter((project) => {
    const hay = `${project.name} ${project.appName} ${project.packageName}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  function submit() {
    if (!form.name.trim() || !form.appName.trim()) {
      setError("请填写工程名和应用名");
      return;
    }
    if (!PACKAGE.test(form.packageName.trim())) {
      setError("包名要像 com.example.app，全部小写");
      return;
    }
    const id = createProject(form);
    setOpen(false);
    void navigate({ to: "/edit/$id", params: { id } });
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold tracking-tight">工程</p>
          <p className="text-sm text-muted">{cloud.detail || "登录后的工程会写到云端"}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm" onClick={() => fileRef.current?.click()}>
            导入
          </button>
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg" onClick={() => { setError(""); setOpen(true); }}>
            <Plus className="size-4" />
            新建
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".bproj,.json,application/json,application/octet-stream"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void file.arrayBuffer().then((buffer) => {
              const bytes = new Uint8Array(buffer);
              const raw = file.name.endsWith(".json") ? JSON.parse(new TextDecoder().decode(bytes)) : readBproj(bytes);
              const id = importProject(raw);
              void navigate({ to: "/edit/$id", params: { id } });
            }).catch(() => setError("这个文件不能导入。请使用本站下载的工程包。"));
          }}
        />
      </header>

      <section className="mt-6 rounded-xl border border-line bg-surface px-4 py-4">
        <h1 className="text-xl font-semibold tracking-tight">编辑免费，打包另计</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          注册后可以建页面、摆组件、预览和保存。工程包和 RPK 分开计分。下载工程包只扣工程下载积分，不会得到源码或安装包。RPK 还没经过官方工具链验证，不会显示打包成功。
        </p>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          <li className="rounded-full border border-line px-3 py-1">工程包 .bproj</li>
          <li className="rounded-full border border-line px-3 py-1">设计宽度 466</li>
          <li className="rounded-full border border-line px-3 py-1 text-warn">RPK 未验证</li>
        </ul>
      </section>

      <div className="mt-5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索工程、应用名或包名"
          className="min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
        />
      </div>

      {!hydrated || !cloud.ready ? (
        <p className="mt-8 text-sm text-muted">{cloud.detail || "正在同步云端工程…"}</p>
      ) : visible.length === 0 ? (
        <p className="mt-8 text-sm text-muted">没有匹配的工程。</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {visible.map((project) => (
            <li key={project.id} className="rounded-xl border border-line bg-surface p-3">
              <Link to="/edit/$id" params={{ id: project.id }} className="flex gap-3">
                <WatchFace page={project.pages[0]} device={project.device} size={96} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold">{project.name}</span>
                  <span className="mt-1 block truncate text-sm text-muted">{project.appName}</span>
                  <span className="mt-1 block truncate font-mono text-xs text-muted">{project.packageName}</span>
                  <span className="mt-2 block text-xs text-muted">
                    {project.pages.length} 页 · {project.nav?.kind === "bottom" ? "底部导航" : project.nav?.kind === "top" ? "顶部导航" : project.nav?.kind === "side" ? "侧边导航" : "无导航"} · {project.revisions.length} 个修订
                  </span>
                </span>
              </Link>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md border border-line text-sm"
                  onClick={() => {
                    const id = duplicateProject(project.id);
                    if (id) void navigate({ to: "/edit/$id", params: { id } });
                  }}
                >
                  <Copy className="size-4" />
                  复制
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md border border-line text-sm text-warn"
                  onClick={() => {
                    if (pendingDelete === project.id) {
                      removeProject(project.id);
                      setPendingDelete(null);
                    } else setPendingDelete(project.id);
                  }}
                >
                  <Trash2 className="size-4" />
                  {pendingDelete === project.id ? "确认删除" : "删除"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="fixed inset-0 z-30 grid place-items-end bg-bg/80 p-4 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
          <form
            className="w-full max-w-md rounded-xl border border-line bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <h2 id="new-project-title" className="text-lg font-semibold">新建应用</h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {TEMPLATES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`min-h-16 rounded-xl border px-3 py-2 text-left ${form.template === item.id ? "border-accent bg-accent text-accent-fg" : "border-line"}`}
                  onClick={() => setForm({ ...form, template: item.id })}
                >
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className={`mt-1 block text-xs ${form.template === item.id ? "text-accent-fg" : "text-muted"}`}>{item.detail}</span>
                </button>
              ))}
            </div>
            <label className="mt-4 block text-sm text-muted">
              工程名
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg" />
            </label>
            <label className="mt-3 block text-sm text-muted">
              应用名
              <input value={form.appName} onChange={(event) => setForm({ ...form, appName: event.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg" />
              <span className="mt-1 block text-xs">商店名称建议不超过 6 个汉字。</span>
            </label>
            <label className="mt-3 block text-sm text-muted">
              包名
              <input value={form.packageName} onChange={(event) => setForm({ ...form, packageName: event.target.value })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg" />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["watch-round", "watch-square"] as DeviceShape[]).map((device) => (
                <button
                  key={device}
                  type="button"
                  className={`min-h-11 rounded-md border text-sm ${form.device === device ? "border-accent bg-accent text-accent-fg" : "border-line"}`}
                  onClick={() => setForm({ ...form, device })}
                >
                  {device === "watch-round" ? "圆表" : "方表"}
                </button>
              ))}
            </div>
            {error ? <p className="mt-3 text-sm text-warn">{error}</p> : null}
            <div className="mt-4 flex gap-2">
              <button type="button" className="min-h-11 flex-1 rounded-md border border-line" onClick={() => setOpen(false)}>
                取消
              </button>
              <button type="submit" className="min-h-11 flex-1 rounded-md bg-accent font-semibold text-accent-fg">
                创建并编辑
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
