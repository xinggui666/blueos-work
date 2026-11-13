import { Card, Stat } from "./ui";
import { bytes, useAdmin } from "./lib";

type Overview = {
  users: number;
  activeUsers7d: number;
  activeUsers30d: number;
  projects: number;
  components: number;
  members: number;
  pending: number;
  spent30d: Record<string, number>;
  orders: Record<string, { count: number; amountCents: number }>;
  builds: { counts: Record<string, number>; successRate: number | null; workersOnline: number };
  failureReasons: { reason: string; count: number }[];
  storage: { projectsBytes: number; revisionsBytes: number; buildsBytes: number; assetsBytes: number; databaseBytes: number };
  note: string;
};

export function OverviewTab({ onError }: { onError: (t: string) => void }) {
  const [o] = useAdmin<Overview>("adminOverview", {}, onError);
  if (!o) return null;
  const c = o.builds.counts;
  const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-4">
      <Stat label="用户" value={o.users} hint={`7 天活跃 ${o.activeUsers7d} · 30 天活跃 ${o.activeUsers30d}`} />
      <Stat label="工程" value={o.projects} />
      <Stat label="上架组件" value={o.components} hint={`待审投稿 ${o.pending}`} />
      <Stat label="有效会员" value={o.members} />
      <Stat label="30 天积分消耗" value={(o.spent30d.build ?? 0) + (o.spent30d.export ?? 0) + (o.spent30d.generation ?? 0)} hint={`打包 ${o.spent30d.build ?? 0} · 下载 ${o.spent30d.export ?? 0} · 源工程 ${o.spent30d.generation ?? 0}`} />
      <Stat
        label="订单"
        value={Object.values(o.orders).reduce((s, x) => s + x.count, 0)}
        hint={`待确认 ${o.orders.pending?.count ?? 0} · 已开通 ${o.orders.confirmed?.count ?? 0}（${yuan(o.orders.confirmed?.amountCents ?? 0)}）· 撤销 ${o.orders.refunded?.count ?? 0}`}
      />
      <Stat
        label="构建成功率"
        value={o.builds.successRate === null ? "—" : `${o.builds.successRate}%`}
        hint={`成功 ${c.succeeded ?? 0} · 失败 ${c.failed ?? 0} · 排队/执行 ${(c.queued ?? 0) + (c.waiting ?? 0) + (c.running ?? 0)} · 在线 Worker ${o.builds.workersOnline}`}
      />
      <Stat label="存储" value={bytes(o.storage.databaseBytes)} hint={`工程 ${bytes(o.storage.projectsBytes)} · 修订 ${bytes(o.storage.revisionsBytes)} · 构建 ${bytes(o.storage.buildsBytes)} · 资源 ${bytes(o.storage.assetsBytes)}`} />
      <Card className="sm:col-span-4">
        <p className="font-medium">构建失败原因</p>
        {o.failureReasons.length ? (
          <ul className="mt-2">
            {o.failureReasons.map((r) => (
              <li key={r.reason} className="mt-1 text-muted">
                {r.count} 次 · {r.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted">没有失败记录。</p>
        )}
        <p className="mt-3 text-xs text-muted">{o.note}</p>
      </Card>
    </div>
  );
}
