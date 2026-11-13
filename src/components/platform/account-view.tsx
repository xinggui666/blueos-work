import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { call, errorText, useMe } from "@/lib/platform/client";
import { yuan } from "@/lib/platform/policy";

type Plan = { id: string; name: string; priceCents: number; durationDays: number; generation: number; build: number; export: number; concurrency: number };
type Me = {
  email: string;
  developerStatus: string;
  roles: string[];
  membership: { endsAt: string; snapshot: { name?: string } } | null;
  quota: Record<"generation" | "build" | "export", { balance: number; reserved: number }>;
  plans: Plan[];
  staff?: boolean;
  release?: { versionName: string; notes: string; apkUrl: string } | null;
};
type Order = { id: string; status: string; amountCents: number; note: string; createdAt: string; snapshot: { name?: string } };
type Ledger = { id: string; kind: string; delta: number; phase: string; note: string; createdAt: string };

const KIND: Record<string, string> = { generation: "历史生成", build: "RPK", export: "工程下载" };
const ORDER: Record<string, string> = { pending: "待确认", confirmed: "已开通", cancelled: "已取消" };

export function AccountView() {
  const { data, error, reload } = useMe<Me>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");

  function loadLists() {
    void call<Order[]>("listOrders").then(setOrders).catch(() => setOrders([]));
    void call<Ledger[]>("ledger").then(setLedger).catch(() => setLedger([]));
  }

  useEffect(() => {
    loadLists();
  }, []);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-xl font-semibold">权益和额度</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">编辑、预览和保存不扣积分。工程下载积分和 RPK 积分分开，不能互相抵扣。购买次数不会解锁会员组件。RPK 工具链还没验证，申请打包不会扣积分，也不会显示成功。</p>
      {error ? <p className="mt-4 text-sm text-warn">{error}</p> : null}
      {!data ? <p className="mt-6 text-sm text-muted">正在读取账号…</p> : null}
      {data ? (
        <>
          <section className="mt-5 rounded-xl border border-line bg-surface p-4">
            <p className="text-sm text-muted">{data.email}</p>
            <p className="mt-2 text-base font-semibold">{data.membership ? `${data.membership.snapshot?.name ?? "会员"} · 到 ${new Date(data.membership.endsAt).toLocaleDateString()}` : "还没有会员"}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {(["generation", "build", "export"] as const).map((kind) => (
                <p key={kind} className="rounded-md border border-line px-3 py-3 text-sm">
                  {KIND[kind]} <span className="font-semibold">{data.quota[kind]?.balance ?? 0}</span>
                  <span className="text-muted"> · 预留 {data.quota[kind]?.reserved ?? 0}</span>
                </p>
              ))}
            </div>
          </section>

          <section className="mt-4 grid gap-2 sm:grid-cols-3">
            <p className="rounded-2xl border border-line bg-white p-4 text-sm leading-6">购买次数只增加额度，不解锁会员组件。</p>
            <p className="rounded-2xl border border-line bg-white p-4 text-sm leading-6">卡密可以兑换会员、额度或指定组件。</p>
            <p className="rounded-2xl border border-line bg-white p-4 text-sm leading-6">会员按后台套餐发放额度和组件权限。到期后不再发新权益，已经生成的源工程不受影响。</p>
          </section>

          <section className="mt-4 rounded-2xl border border-line bg-white p-4">
            <h2 className="text-base font-semibold">兑换卡密</h2>
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                setNote("");
                void call("redeem", { code })
                  .then(() => {
                    setCode("");
                    setNote("兑换成功");
                    reload();
                    loadLists();
                  })
                  .catch((reason) => setNote(errorText(reason)));
              }}
            >
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="BH-XXXX-XXXX" className="min-h-11 flex-1 rounded-md border border-line bg-bg px-3 font-mono text-sm" />
              <button type="submit" className="min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg">兑换</button>
            </form>
            {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
          </section>

          <section className="mt-4">
            <h2 className="text-base font-semibold">套餐</h2>
            <p className="mt-1 text-sm text-muted">下单后由后台人工确认，这里没有自动支付。</p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {data.plans.map((plan) => (
                <li key={plan.id} className="rounded-xl border border-line bg-surface p-4">
                  <h3 className="font-semibold">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted">{yuan(plan.priceCents)} · {plan.durationDays} 天</p>
                  <p className="mt-2 text-sm leading-6 text-muted">历史生成 {plan.generation} · 工程下载 {plan.export} · RPK {plan.build} · 同时 {plan.concurrency} 个任务</p>
                  <button
                    type="button"
                    className="mt-3 min-h-11 rounded-md border border-line px-3 text-sm"
                    onClick={() => {
                      void call("createOrder", { planId: plan.id })
                        .then(() => {
                          setNote("订单已提交，等待后台确认");
                          loadLists();
                        })
                        .catch((reason) => setNote(errorText(reason)));
                    }}
                  >
                    提交订单
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6 flex flex-wrap gap-2">
            <Link to="/developer" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm">组件投稿</Link>
            <Link to="/jobs" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm">生成任务</Link>
            {data.staff ? <Link to="/admin" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm">后台</Link> : null}
          </section>
          {data.release ? (
            <p className="mt-4 text-sm text-muted">
              版本记录 {data.release.versionName}。{data.release.apkUrl ? "已登记安装包地址。" : "还没有可安装的 Android 包。"} {data.release.notes}
            </p>
          ) : null}

          <section className="mt-6">
            <h2 className="text-base font-semibold">订单</h2>
            <ul className="mt-3">
              {orders.length === 0 ? <li className="text-sm text-muted">还没有订单。</li> : null}
              {orders.map((order) => (
                <li key={order.id} className="mt-2 rounded-md border border-line px-3 py-3 text-sm">
                  <span className="font-medium">{order.snapshot?.name ?? "套餐"}</span>
                  <span className="ml-2 text-muted">{ORDER[order.status] ?? order.status} · {yuan(order.amountCents)}</span>
                  <span className="mt-1 block text-xs text-muted">{order.note}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6">
            <h2 className="text-base font-semibold">额度流水</h2>
            <ul className="mt-3">
              {ledger.map((row) => (
                <li key={row.id} className="mt-2 flex items-baseline justify-between gap-3 text-sm">
                  <span>{KIND[row.kind] ?? row.kind} · {row.phase} · {row.note}</span>
                  <span className="font-mono text-muted">{row.delta > 0 ? `+${row.delta}` : row.delta}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
