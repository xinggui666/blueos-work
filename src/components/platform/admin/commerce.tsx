import { useState } from "react";
import { call, errorText } from "@/lib/platform/client";
import { yuan } from "@/lib/platform/policy";
import { Card } from "./ui";
import { STATUS_TEXT, act, download, field, ghost, primary, useAdmin, when } from "./lib";

type Plan = {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  durationDays: number;
  generation: number;
  build: number;
  export: number;
  concurrency: number;
  projectLimit: number;
  storageMb: number;
  priority: number;
  dailyBuild: number;
  monthlyBuild: number;
  bonusBuild: number;
  categories: string;
  active: boolean;
};
const EMPTY_PLAN: Plan = {
  id: "plan_custom",
  slug: "custom",
  name: "自定义会员",
  priceCents: 3900,
  durationDays: 30,
  generation: 20,
  build: 0,
  export: 10,
  concurrency: 1,
  projectLimit: 20,
  storageMb: 300,
  priority: 0,
  dailyBuild: 0,
  monthlyBuild: 0,
  bonusBuild: 0,
  categories: "",
  active: true,
};
const PLAN_FIELDS: [keyof Plan, string][] = [
  ["id", "编号"],
  ["slug", "标识"],
  ["name", "名称"],
  ["priceCents", "价格（分）"],
  ["durationDays", "有效天数"],
  ["build", "RPK 打包积分"],
  ["monthlyBuild", "月度积分规则（预留，未启用自动发放）"],
  ["bonusBuild", "赠送打包积分"],
  ["export", "工程下载积分"],
  ["generation", "源工程积分"],
  ["projectLimit", "工程上限（0 不限）"],
  ["storageMb", "存储空间 MB"],
  ["concurrency", "并发构建任务"],
  ["priority", "构建优先级 0–9"],
  ["categories", "会员组件分类（逗号分隔，空 = 全部）"],
];

export function PlansTab({ onError }: { onError: (t: string) => void }) {
  const [plans, reload] = useAdmin<Plan[]>("adminPlans", {}, onError);
  const [form, setForm] = useState<Plan>(EMPTY_PLAN);
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <Card>
        <p className="font-semibold">新建或编辑套餐</p>
        <p className="mt-1 text-muted">开通时按快照发放；之后改套餐不影响已开通的会员。</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PLAN_FIELDS.map(([key, label]) => (
            <label key={key} className="text-muted">
              {label}
              <input
                value={String(form[key])}
                onChange={(e) => setForm({ ...form, [key]: typeof EMPTY_PLAN[key] === "number" ? Number(e.target.value) || 0 : e.target.value })}
                className={field}
              />
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            生效
          </label>
        </div>
        <button type="button" className={`${primary} mt-3`} onClick={() => act(onError, "adminSavePlan", { plan: form }, reload)}>
          保存套餐
        </button>
      </Card>
      <ul className="grid content-start gap-2">
        {(plans ?? []).map((p) => (
          <li key={p.id}>
            <Card>
              <p className="font-medium">
                {p.name} · {yuan(p.priceCents)} · {p.durationDays} 天{p.active ? "" : " · 已下架"}
              </p>
              <p className="mt-1 text-muted">
                打包 {p.build}（一次性赠送 {p.bonusBuild}；月度规则 {p.monthlyBuild} 尚未启用）· 下载 {p.export} · 源工程 {p.generation} · 工程 {p.projectLimit || "不限"} · {p.storageMb} MB · 并发 {p.concurrency} · 优先级 {p.priority}
                {p.categories ? ` · 组件分类 ${p.categories}` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" className={ghost} onClick={() => setForm(p)}>
                  编辑
                </button>
                <button type="button" className={ghost} onClick={() => act(onError, "adminSavePlan", { plan: { ...p, active: !p.active } }, reload)}>
                  {p.active ? "下架" : "上架"}
                </button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Batch = { id: string; type: string; title: string; quantity: number; unused: number; used: number; voided: number; expired: number; expiresAt: string | null; createdAt: string | null };
type Key = { id: string; hint: string; type: string; status: string; title: string; expiresAt: string | null; usedAt: string | null; usedBy: string };

export function KeysTab({ onError }: { onError: (t: string) => void }) {
  const [batchId, setBatchId] = useState("");
  const [status, setStatus] = useState("");
  const [batches, reloadBatches] = useAdmin<Batch[]>("adminKeyBatches", {}, onError);
  const [keys, reloadKeys] = useAdmin<Key[]>("adminKeys", { batchId, status }, onError);
  const [activations] = useAdmin<{ id: string; hint: string; email: string; result: string; createdAt: string | null }[]>("adminKeyActivations", {}, onError);
  const [plans] = useAdmin<{ id: string; name: string }[]>("adminPlans", {}, onError);
  const [components] = useAdmin<{ id: string; name: string }[]>("adminComponents", {}, onError);
  const [form, setForm] = useState({ type: "quota", title: "运营额度", quantity: "5", expiresInDays: "30", planId: "", componentId: "", build: "1", export: "0", generation: "0" });
  const [fresh, setFresh] = useState<string[]>([]);
  const reload = () => {
    reloadBatches();
    reloadKeys();
  };
  const payload =
    form.type === "membership"
      ? { planId: form.planId }
      : form.type === "component"
        ? { componentId: form.componentId }
        : form.type === "quota"
          ? { build: Number(form.build), export: Number(form.export), generation: Number(form.generation) }
          : { planId: form.planId || undefined, componentId: form.componentId || undefined, build: Number(form.build), export: Number(form.export), generation: Number(form.generation) };
  return (
    <div className="mt-5 grid gap-4">
      <Card>
        <p className="font-semibold">批量生成</p>
        <p className="mt-1 text-muted">明文卡密只在生成后显示这一次，数据库只存哈希。</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <label className="text-muted">
            类型
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={field}>
              <option value="quota">积分</option>
              <option value="membership">会员</option>
              <option value="component">组件</option>
              <option value="custom">组合</option>
            </select>
          </label>
          <label className="text-muted">
            标题
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={field} />
          </label>
          <label className="text-muted">
            数量（≤ 50）
            <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={field} />
          </label>
          <label className="text-muted">
            有效天数（0 不过期）
            <input value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} className={field} />
          </label>
          {form.type === "membership" || form.type === "custom" ? (
            <label className="text-muted">
              套餐
              <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} className={field}>
                <option value="">选择…</option>
                {(plans ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {form.type === "component" || form.type === "custom" ? (
            <label className="text-muted">
              组件
              <select value={form.componentId} onChange={(e) => setForm({ ...form, componentId: e.target.value })} className={field}>
                <option value="">选择…</option>
                {(components ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {form.type === "quota" || form.type === "custom"
            ? (
                [
                  ["build", "RPK 打包"],
                  ["export", "工程下载"],
                  ["generation", "源工程"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="text-muted">
                  {label}
                  <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={field} />
                </label>
              ))
            : null}
        </div>
        <button
          type="button"
          className={`${primary} mt-3`}
          onClick={() =>
            act(onError, "adminCreateKeys", { type: form.type, title: form.title, quantity: Number(form.quantity), expiresInDays: Number(form.expiresInDays), payload }, (r) => {
              setFresh((r as { codes: string[] }).codes);
              reload();
            })
          }
        >
          生成并显示一次
        </button>
        {fresh.length ? <textarea readOnly aria-label="新卡密" value={fresh.join("\n")} className="mt-3 min-h-32 w-full rounded-md border border-line bg-bg p-3 font-mono text-sm" /> : null}
      </Card>

      <Card>
        <p className="font-semibold">批次</p>
        <ul className="mt-2">
          {(batches ?? []).map((b) => (
            <li key={b.id} className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="text-left" onClick={() => setBatchId(batchId === b.id ? "" : b.id)}>
                <span className={batchId === b.id ? "font-semibold" : ""}>{b.title}</span>
                <span className="text-muted">
                  {" "}
                  · {b.type} · 共 {b.quantity} · 未用 {b.unused} · 已用 {b.used} · 作废/冻结 {b.voided} · 过期 {b.expired} · {when(b.createdAt)}
                </span>
              </button>
              <button
                type="button"
                className={ghost}
                onClick={() =>
                  call<{ fileName: string; csv: string }>("adminExportKeys", { batchId: b.id })
                    .then((r) => download(r.fileName, r.csv, "text/csv;charset=utf-8"))
                    .catch((reason) => onError(errorText(reason)))
                }
              >
                导出安全清单
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">卡密{batchId ? "（已筛选批次）" : ""}</p>
          <select aria-label="卡密状态" value={status} onChange={(e) => setStatus(e.target.value)} className="min-h-9 rounded-md border border-line bg-bg px-2 text-sm">
            <option value="">全部状态</option>
            {["unused", "used", "frozen", "void"].map((s) => (
              <option key={s} value={s}>
                {STATUS_TEXT[s]}
              </option>
            ))}
          </select>
        </div>
        <ul className="mt-2">
          {(keys ?? []).map((k) => (
            <li key={k.id} className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-mono">{k.hint}</span>
                <span className="text-muted">
                  {" "}
                  · {k.title} · {k.type} · {STATUS_TEXT[k.status] ?? k.status}
                  {k.usedBy ? ` · ${k.usedBy} 于 ${when(k.usedAt)} 兑换` : ""}
                  {k.expiresAt ? ` · 有效期至 ${when(k.expiresAt)}` : ""}
                </span>
              </span>
              {k.status === "unused" ? (
                <span className="flex gap-2">
                  <button type="button" className={ghost} onClick={() => act(onError, "adminSetKey", { id: k.id, status: "frozen" }, reload)}>
                    冻结
                  </button>
                  <button type="button" className={ghost} onClick={() => act(onError, "adminSetKey", { id: k.id, status: "void" }, reload)}>
                    作废
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <p className="font-semibold">兑换记录</p>
        <ul className="mt-2">
          {(activations ?? []).map((a) => (
            <li key={a.id} className="mt-1 text-muted">
              {when(a.createdAt)} · {a.email || "未知用户"} · {a.hint} · {a.result === "ok" ? "成功" : a.result}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

type Order = { id: string; userId: string; status: string; amountCents: number; note: string; snapshot: { name?: string }; createdAt: string | null };
type OrderDetail = Order & {
  email: string;
  memberships: { planId: string; startsAt: string | null; endsAt: string | null }[];
  ledger: { kind: string; delta: number; phase: string; note: string; createdAt: string | null }[];
  logs: { action: string; actorId: string; createdAt: string | null }[];
};

export function OrdersTab({ onError }: { onError: (t: string) => void }) {
  const [orders, reload] = useAdmin<Order[]>("adminOrders", {}, onError);
  const [filter, setFilter] = useState("");
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [note, setNote] = useState("");
  const open = (id: string) =>
    call<OrderDetail>("adminOrder", { id })
      .then(setDetail)
      .catch((reason) => onError(errorText(reason)));
  const after = (id: string) => () => {
    reload();
    void open(id);
  };
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div>
        <select aria-label="订单状态" value={filter} onChange={(e) => setFilter(e.target.value)} className={field}>
          <option value="">全部</option>
          {["pending", "confirmed", "cancelled", "refunded"].map((s) => (
            <option key={s} value={s}>
              {STATUS_TEXT[s] ?? s}
            </option>
          ))}
        </select>
        <ul className="mt-2 grid gap-2">
          {(orders ?? [])
            .filter((o) => !filter || o.status === filter)
            .map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => void open(o.id)} className={`w-full rounded-xl border bg-surface p-3 text-left text-sm ${detail?.id === o.id ? "border-accent" : "border-line"}`}>
                  {o.snapshot?.name ?? "套餐"} · {STATUS_TEXT[o.status] ?? o.status} · {yuan(o.amountCents)}
                  <span className="mt-1 block text-xs text-muted">
                    {when(o.createdAt)} · {o.id}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </div>
      {detail ? (
        <Card>
          <p className="text-base font-semibold">
            {detail.snapshot?.name ?? "套餐"} · {STATUS_TEXT[detail.status] ?? detail.status} · {yuan(detail.amountCents)}
          </p>
          <p className="mt-1 text-muted">
            {detail.email} · 下单 {when(detail.createdAt)} · {detail.note}
          </p>
          <input aria-label="订单备注" placeholder="备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} className={field} />
          <div className="mt-2 flex flex-wrap gap-2">
            {detail.status === "pending" ? (
              <>
                <button type="button" className={primary} onClick={() => act(onError, "adminConfirmOrder", { id: detail.id, decision: "confirm", note }, after(detail.id))}>
                  确认到账并开通
                </button>
                <button type="button" className={ghost} onClick={() => act(onError, "adminConfirmOrder", { id: detail.id, decision: "cancel", note }, after(detail.id))}>
                  取消订单
                </button>
              </>
            ) : null}
            {detail.status === "confirmed" ? (
              <button type="button" className={ghost} onClick={() => act(onError, "adminRefundOrder", { id: detail.id, note }, after(detail.id))}>
                退款 / 撤销权益
              </button>
            ) : null}
          </div>
          <p className="mt-3 font-medium">权益发放记录</p>
          <ul className="mt-1 text-muted">
            {detail.memberships.map((m, i) => (
              <li key={i}>
                会员 {m.planId}：{when(m.startsAt)} → {when(m.endsAt)}
              </li>
            ))}
            {detail.ledger.map((l, i) => (
              <li key={`l${i}`}>
                {when(l.createdAt)} · {l.kind} {l.delta > 0 ? `+${l.delta}` : l.delta} · {l.note}
              </li>
            ))}
            {!detail.memberships.length && !detail.ledger.length ? <li>还没有发放。</li> : null}
          </ul>
          <p className="mt-3 font-medium">操作记录</p>
          <ul className="mt-1 text-muted">
            {detail.logs.map((l, i) => (
              <li key={i}>
                {when(l.createdAt)} · {l.action}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <p className="text-sm text-muted">选择订单查看详情。</p>
      )}
    </div>
  );
}
