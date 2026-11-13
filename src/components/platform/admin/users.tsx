import { useState } from "react";
import { call, errorText } from "@/lib/platform/client";
import { Card } from "./ui";
import { STATUS_TEXT, act, bytes, field, ghost, primary, useAdmin, when } from "./lib";

type UserRow = { id: string; email: string; name: string; status: string; developerStatus: string; roles: string[]; createdAt: string };
type Detail = {
  id: string;
  email: string;
  name: string;
  createdAt: string | null;
  status: string;
  developerStatus: string;
  roles: string[];
  quota: Record<string, { balance: number; reserved: number }>;
  membership: { planId: string; endsAt: string; snapshot: { name?: string } } | null;
  projectList: { id: string; name: string; packageName: string; device: string; revision: number; bytes: number; updatedAt: string | null }[];
  builds: { id: string; projectId: string; status: string; quotaState: string; error: string; createdAt: string | null }[];
  jobs: { id: string; kind: string; status: string; message: string; createdAt: string | null }[];
  ledger: { kind: string; delta: number; phase: string; ref: string; note: string; createdAt: string | null }[];
  grants: { componentId: string; name: string; source: string }[];
  devices: { client: string; lastSeen: string | null }[];
  logs: { action: string; actorId: string; createdAt: string | null }[];
};
const ROLES = [
  ["reviewer", "审核员"],
  ["operator", "运营"],
  ["admin", "管理员"],
  ["super_admin", "超级管理员"],
] as const;
const KIND = { build: "RPK 打包", export: "工程下载", generation: "源工程" } as Record<string, string>;

export function UsersTab({ onError }: { onError: (t: string) => void }) {
  const [query, setQuery] = useState("");
  const [users, reload] = useAdmin<UserRow[]>("adminUsers", { query }, onError);
  const [selected, setSelected] = useState("");
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索邮箱或名字" aria-label="搜索用户" className={field} />
        <ul className="mt-3 grid gap-2">
          {(users ?? []).map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => setSelected(u.id)} className={`w-full rounded-xl border p-3 text-left text-sm ${selected === u.id ? "border-accent" : "border-line"} bg-surface`}>
                <span className="block font-medium">{u.email}</span>
                <span className="mt-1 block text-xs text-muted">
                  {u.name} · {STATUS_TEXT[u.status] ?? u.status} · {u.roles.length ? u.roles.join("、") : "普通用户"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {selected ? <UserDetail key={selected} userId={selected} onError={onError} onChanged={reload} /> : <p className="text-sm text-muted">选择左侧用户查看资料。</p>}
    </div>
  );
}

function UserDetail({ userId, onError, onChanged }: { userId: string; onError: (t: string) => void; onChanged: () => void }) {
  const [d, reload] = useAdmin<Detail>("adminUser", { userId }, onError);
  const [plans] = useAdmin<{ id: string; name: string; active: boolean }[]>("adminPlans", {}, onError);
  const [components] = useAdmin<{ id: string; name: string; slug: string }[]>("adminComponents", {}, onError);
  const [kind, setKind] = useState("build");
  const [delta, setDelta] = useState("1");
  const [note, setNote] = useState("后台补发");
  const [planId, setPlanId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [view, setView] = useState<string>("");
  if (!d) return null;
  const done = () => {
    reload();
    onChanged();
  };
  return (
    <div className="grid gap-3" data-testid="user-detail">
      <Card>
        <p className="text-base font-semibold">{d.email}</p>
        <p className="mt-1 text-muted">
          {d.name} · 注册 {when(d.createdAt)} · {STATUS_TEXT[d.status] ?? d.status} · 开发者 {d.developerStatus}
        </p>
        <p className="mt-1 text-muted">
          会员：{d.membership ? `${d.membership.snapshot?.name ?? d.membership.planId}，到 ${when(d.membership.endsAt)}` : "无"} · 设备：
          {d.devices.map((x) => `${x.client} ${when(x.lastSeen)}`).join("；") || "无"}
        </p>
        <p className="mt-1 text-muted">
          积分：
          {Object.entries(d.quota)
            .map(([k, v]) => `${KIND[k] ?? k} ${v.balance}${v.reserved ? `（预扣 ${v.reserved}）` : ""}`)
            .join(" · ") || "无"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={ghost} onClick={() => act(onError, "adminSetStatus", { userId, status: d.status === "banned" ? "active" : "banned" }, done)}>
            {d.status === "banned" ? "解封" : "封禁（立即踢下线）"}
          </button>
          {ROLES.map(([role, label]) => (
            <button key={role} type="button" className={ghost} onClick={() => act(onError, "adminSetRole", { userId, role, grant: !d.roles.includes(role) }, done)}>
              {d.roles.includes(role) ? `撤销${label}` : `设为${label}`}
            </button>
          ))}
          <button type="button" className={ghost} onClick={() => act(onError, "adminSetDeveloper", { userId, status: d.developerStatus === "approved" ? "suspended" : "approved" }, done)}>
            {d.developerStatus === "approved" ? "暂停开发者" : "通过开发者"}
          </button>
        </div>
      </Card>

      <Card>
        <p className="font-medium">积分补发 / 扣回</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <select aria-label="积分类型" value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            <option value="build">RPK 打包</option>
            <option value="export">工程下载</option>
            <option value="generation">源工程</option>
          </select>
          <input aria-label="数量" value={delta} onChange={(e) => setDelta(e.target.value)} className={field} />
          <input aria-label="备注" value={note} onChange={(e) => setNote(e.target.value)} className={`${field} sm:col-span-2`} />
        </div>
        <button type="button" className={`${primary} mt-2`} onClick={() => act(onError, "adminGrantQuota", { userId, kind, delta: Number(delta), note }, done)}>
          调整积分
        </button>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <select aria-label="套餐" value={planId} onChange={(e) => setPlanId(e.target.value)} className={field}>
              <option value="">选择套餐…</option>
              {(plans ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.active ? "" : "（已下架）"}
                </option>
              ))}
            </select>
            <button type="button" disabled={!planId} className={`${ghost} mt-2`} onClick={() => act(onError, "adminGrantMembership", { userId, planId }, done)}>
              开通 / 续期会员
            </button>
          </div>
          <div>
            <select aria-label="组件" value={componentId} onChange={(e) => setComponentId(e.target.value)} className={field}>
              <option value="">选择组件…</option>
              {(components ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.slug}
                </option>
              ))}
            </select>
            <button type="button" disabled={!componentId} className={`${ghost} mt-2`} onClick={() => act(onError, "adminGrantComponent", { userId, componentId }, done)}>
              授权组件
            </button>
          </div>
        </div>
        {d.grants.length ? (
          <ul className="mt-3">
            {d.grants.map((g) => (
              <li key={g.componentId} className="mt-1 flex items-center justify-between gap-2 text-muted">
                <span>
                  {g.name} · 来源 {g.source}
                </span>
                <button type="button" className={ghost} onClick={() => act(onError, "adminRevokeComponent", { userId, componentId: g.componentId }, done)}>
                  撤销授权
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card>
        <p className="font-medium">工程（{d.projectList.length}）</p>
        <ul className="mt-2">
          {d.projectList.map((p) => (
            <li key={p.id} className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span>
                {p.name} <span className="font-mono text-xs text-muted">{p.packageName}</span>
                <span className="text-xs text-muted">
                  {" "}
                  · 修订 {p.revision} · {bytes(p.bytes)} · {when(p.updatedAt)}
                </span>
              </span>
              <button
                type="button"
                className={ghost}
                onClick={() =>
                  call<{ doc: unknown; revision: number }>("adminUserProject", { userId, projectId: p.id })
                    .then((r) => setView(JSON.stringify(r.doc, null, 2)))
                    .catch((reason) => onError(errorText(reason)))
                }
              >
                只读查看
              </button>
            </li>
          ))}
        </ul>
        {view ? <pre className="mt-2 max-h-72 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px]">{view}</pre> : null}
      </Card>

      <Card>
        <p className="font-medium">构建与任务</p>
        <ul className="mt-2">
          {d.builds.map((b) => (
            <li key={b.id} className="mt-1 text-muted">
              {when(b.createdAt)} · RPK · {STATUS_TEXT[b.status] ?? b.status} · {b.quotaState}
              {b.error ? ` · ${b.error}` : ""}
            </li>
          ))}
          {d.jobs.map((j) => (
            <li key={j.id} className="mt-1 text-muted">
              {when(j.createdAt)} · {j.kind} · {STATUS_TEXT[j.status] ?? j.status} · {j.message}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <p className="font-medium">积分流水</p>
        <ul className="mt-2">
          {d.ledger.map((l, i) => (
            <li key={i} className="mt-1 text-muted">
              {when(l.createdAt)} · {KIND[l.kind] ?? l.kind} {l.delta > 0 ? `+${l.delta}` : l.delta} · {l.phase} · {l.note}
            </li>
          ))}
        </ul>
        <p className="mt-3 font-medium">操作记录</p>
        <ul className="mt-2">
          {d.logs.map((l, i) => (
            <li key={i} className="mt-1 text-muted">
              {when(l.createdAt)} · {l.action}
              {l.actorId === d.id ? "（本人）" : ""}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
