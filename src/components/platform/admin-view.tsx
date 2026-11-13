import { useEffect, useState } from "react";
import { call, errorText } from "@/lib/platform/client";
import { CONFIG_KEYS, yuan } from "@/lib/platform/policy";

const TABS = ["总览", "用户", "组件", "投稿", "套餐", "卡密", "订单", "任务", "版本", "开关", "公告", "审计"] as const;
type Tab = (typeof TABS)[number];

type UserRow = { id: string; email: string; name: string; status: string; developerStatus: string; roles: string[]; createdAt: string };
type Detail = {
  projects: number;
  quota: Record<string, { balance: number; reserved: number }>;
  membership: { endsAt: string; snapshot: { name?: string } } | null;
  jobs: { id: string; kind: string; status: string; message: string }[];
};

const field = "mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-sm text-fg";
const ghost = "min-h-11 rounded-md border border-line px-3 text-sm";

export function AdminView() {
  const [tab, setTab] = useState<Tab>("总览");
  const [tick, setTick] = useState(0);
  const bump = () => setTick((value) => value + 1);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<{ users: number; members: number; components: number; pending: number; generated: number; failed: number; note: string } | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState("");
  const [components, setComponents] = useState<{ id: string; name: string; slug: string; code?: string; access: string; status: string }[]>([]);
  const [submissions, setSubmissions] = useState<{ id: string; name: string; slug: string; status: string; summary: string; reviewNote: string; userId: string }[]>([]);
  const [plans, setPlans] = useState<{ id: string; slug: string; name: string; priceCents: number; durationDays: number; generation: number; build: number; export: number; concurrency: number; projectLimit: number; monthlyBuild: number; bonusBuild: number; storageMb: number; categories: string; active: boolean }[]>([]);
  const [planForm, setPlanForm] = useState({ id: "plan_custom", slug: "custom", name: "自定义会员", priceCents: "3900", durationDays: "30", generation: "20", export: "10", build: "0", monthlyBuild: "0", projectLimit: "20", storageMb: "300" });
  const [releases, setReleases] = useState<{ id: string; channel: string; versionName: string; versionCode: number; force: boolean; notes: string; apkUrl: string; active: boolean }[]>([]);
  const [releaseForm, setReleaseForm] = useState({ versionName: "1.0.0", versionCode: "1", minVersionCode: "1", notes: "", apkUrl: "", sha256: "", channel: "stable", force: false });
  const [keys, setKeys] = useState<{ id: string; hint: string; type: string; status: string; title: string }[]>([]);
  const [freshCodes, setFreshCodes] = useState<string[]>([]);
  const [keyForm, setKeyForm] = useState({ type: "quota", title: "运营额度", quantity: "5", planId: "plan_member", componentId: "cmp_hotspot", generation: "20", export: "10", build: "0", expiresInDays: "30" });
  const [orders, setOrders] = useState<{ id: string; userId: string; status: string; amountCents: number; note: string; snapshot: { name?: string } }[]>([]);
  const [jobs, setJobs] = useState<{ id: string; userId: string; kind: string; status: string; message: string }[]>([]);
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [announcements, setAnnouncements] = useState<{ id: string; title: string; body: string; active: boolean }[]>([]);
  const [audit, setAudit] = useState<{ id: string; actorId: string; action: string; target: string; createdAt: string }[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  useEffect(() => {
    setError("");
    const run = async () => {
      if (tab === "总览") setOverview(await call("adminOverview"));
      if (tab === "用户") setUsers(await call("adminUsers", { query }));
      if (tab === "组件") setComponents(await call("adminComponents"));
      if (tab === "投稿") setSubmissions(await call("adminSubmissions"));
      if (tab === "套餐") setPlans(await call("adminPlans"));
      if (tab === "版本") setReleases(await call("adminReleases"));
      if (tab === "卡密") setKeys(await call("adminKeys"));
      if (tab === "订单") setOrders(await call("adminOrders"));
      if (tab === "任务") setJobs(await call("adminJobs"));
      if (tab === "开关") setFlags(await call("adminConfig"));
      if (tab === "公告") setAnnouncements(await call("adminAnnouncements"));
      if (tab === "审计") setAudit(await call("adminAudit"));
    };
    void run().catch((reason) => setError(errorText(reason)));
  }, [tab, query, tick]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-xl font-semibold">超级后台</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">第一个注册的账号会成为超级管理员，并写入审计。普通接口不能把自己提成超级管理员。打开“允许构建”也不会调用未验证的官方编译器。</p>
      <div className="studio-scroll mt-4 flex gap-2 overflow-x-auto">
        {TABS.map((item) => (
          <button key={item} type="button" className={`shrink-0 rounded-md px-3 py-2 text-sm ${tab === item ? "bg-accent text-accent-fg" : "border border-line text-muted"}`} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>
      {error ? <p className="mt-4 text-sm text-warn">{error}</p> : null}

      {tab === "总览" && overview ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["用户", overview.users],
            ["有效会员", overview.members],
            ["上架组件", overview.components],
            ["待审投稿", overview.pending],
            ["生成成功", overview.generated],
            ["生成失败", overview.failed],
          ].map(([label, value]) => (
            <p key={String(label)} className="rounded-xl border border-line bg-surface px-4 py-4 text-sm">
              <span className="block text-muted">{label}</span>
              <span className="mt-1 block text-2xl font-semibold">{String(value)}</span>
            </p>
          ))}
          <p className="rounded-xl border border-line bg-surface px-4 py-4 text-sm leading-6 text-muted sm:col-span-3">{String(overview.note ?? "")}</p>
        </div>
      ) : null}

      {tab === "用户" ? (
        <div className="mt-5">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮箱或名字" className={field} />
          <ul className="mt-4">
            {users.map((user) => (
              <li key={user.id} className="mt-3 rounded-xl border border-line bg-surface p-4">
                <button type="button" className="text-left" onClick={() => {
                  setSelected(user.id);
                  void call<Detail>("adminUser", { userId: user.id }).then(setDetail).catch((reason) => setError(errorText(reason)));
                }}>
                  <span className="block font-medium">{user.email}</span>
                  <span className="mt-1 block text-xs text-muted">{user.name} · {user.status} · {user.developerStatus} · {user.roles.join("、") || "普通用户"}</span>
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={ghost} onClick={() => void call("adminSetStatus", { userId: user.id, status: user.status === "banned" ? "active" : "banned" }).then(bump).catch((reason) => setError(errorText(reason)))}>
                    {user.status === "banned" ? "解封" : "封禁"}
                  </button>
                  {(["reviewer", "operator", "admin", "super_admin"] as const).map((role) => (
                    <button key={role} type="button" className={ghost} onClick={() => void call("adminSetRole", { userId: user.id, role, grant: !user.roles.includes(role) }).then(bump).catch((reason) => setError(errorText(reason)))}>
                      {user.roles.includes(role) ? `移除${role}` : role}
                    </button>
                  ))}
                  <button type="button" className={ghost} onClick={() => void call("adminSetDeveloper", { userId: user.id, status: "approved" }).catch((reason) => setError(errorText(reason)))}>通过开发者</button>
                  <button type="button" className={ghost} onClick={() => void call("adminGrantQuota", { userId: user.id, kind: "generation", delta: 20, note: "后台补发" }).catch((reason) => setError(errorText(reason)))}>生成 +20</button>
                  <button type="button" className={ghost} onClick={() => void call("adminGrantQuota", { userId: user.id, kind: "export", delta: 10, note: "后台补发" }).catch((reason) => setError(errorText(reason)))}>导出 +10</button>
                  <button type="button" className={ghost} onClick={() => void call("adminGrantMembership", { userId: user.id, planId: "plan_member" }).catch((reason) => setError(errorText(reason)))}>开通会员</button>
                  <button type="button" className={ghost} onClick={() => void call("adminGrantComponent", { userId: user.id, componentId: "cmp_hotspot" }).catch((reason) => setError(errorText(reason)))}>授权热区</button>
                </div>
                {selected === user.id && detail ? (
                  <p className="mt-3 text-sm leading-6 text-muted">
                    工程 {detail.projects} · 生成 {detail.quota.generation?.balance ?? 0} · 导出 {detail.quota.export?.balance ?? 0}
                    {detail.membership ? ` · 会员到 ${new Date(detail.membership.endsAt).toLocaleDateString()}` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "组件" ? (
        <ul className="mt-5">
          {components.map((item) => (
            <li key={item.id} className="mt-3 rounded-xl border border-line bg-surface p-4 text-sm">
              <p className="font-medium">{item.code ? `${item.code} · ` : ""}{item.name} <span className="font-mono text-xs text-muted">{item.slug}</span></p>
              <div className="mt-3 flex flex-wrap gap-2">
                {["public_free", "membership", "license_key", "specific_user", "internal", "disabled"].map((access) => (
                  <button key={access} type="button" className={ghost} onClick={() => void call("adminSetComponent", { id: item.id, access, status: access === "disabled" ? "unpublished" : "published" }).then(bump).catch((reason) => setError(errorText(reason)))}>
                    {item.access === access ? "当前 · " : ""}{access}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {tab === "投稿" ? (
        <ul className="mt-5">
          {submissions.map((item) => (
            <li key={item.id} className="mt-3 rounded-xl border border-line bg-surface p-4 text-sm">
              <p className="font-medium">{item.name} · {item.status}</p>
              <p className="mt-1 text-muted">{item.summary}</p>
              <p className="mt-1 font-mono text-xs text-muted">{item.slug}</p>
              {item.reviewNote ? <p className="mt-1 text-muted">{item.reviewNote}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={ghost} onClick={() => void call("adminReview", { id: item.id, decision: "approve", note: "人工通过" }).then(bump).catch((reason) => setError(errorText(reason)))}>通过</button>
                <button type="button" className={ghost} onClick={() => void call("adminReview", { id: item.id, decision: "changes", note: "请补充说明" }).catch((reason) => setError(errorText(reason)))}>退回</button>
                <button type="button" className={ghost} onClick={() => void call("adminReview", { id: item.id, decision: "reject", note: "不符合目录要求" }).catch((reason) => setError(errorText(reason)))}>拒绝</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {tab === "套餐" ? (
        <div className="mt-5">
          <form
            className="rounded-xl border border-line bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void call("adminSavePlan", {
                plan: {
                  id: planForm.id.trim(),
                  slug: planForm.slug.trim(),
                  name: planForm.name.trim(),
                  priceCents: Number(planForm.priceCents),
                  durationDays: Number(planForm.durationDays),
                  generation: Number(planForm.generation),
                  export: Number(planForm.export),
                  build: Number(planForm.build),
                  monthlyBuild: Number(planForm.monthlyBuild),
                  projectLimit: Number(planForm.projectLimit),
                  storageMb: Number(planForm.storageMb),
                  active: true,
                },
              }).then(bump).catch((reason) => setError(errorText(reason)));
            }}
          >
            <h2 className="font-semibold">新建或覆盖套餐</h2>
            <p className="mt-1 text-sm text-muted">会员名称、价格、额度和工程上限都写在这里，不写死在客户端。工程上限填 0 表示不限制。开通时发放打包次数，每日不会自动刷新。</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-sm text-muted">编号<input value={planForm.id} onChange={(event) => setPlanForm({ ...planForm, id: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">标识<input value={planForm.slug} onChange={(event) => setPlanForm({ ...planForm, slug: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">名称<input value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">价格（分）<input value={planForm.priceCents} onChange={(event) => setPlanForm({ ...planForm, priceCents: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">有效天数<input value={planForm.durationDays} onChange={(event) => setPlanForm({ ...planForm, durationDays: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">源工程次数<input value={planForm.generation} onChange={(event) => setPlanForm({ ...planForm, generation: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">下载次数<input value={planForm.export} onChange={(event) => setPlanForm({ ...planForm, export: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">打包次数<input value={planForm.build} onChange={(event) => setPlanForm({ ...planForm, build: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">每月打包次数<input value={planForm.monthlyBuild} onChange={(event) => setPlanForm({ ...planForm, monthlyBuild: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">工程上限<input value={planForm.projectLimit} onChange={(event) => setPlanForm({ ...planForm, projectLimit: event.target.value })} className={field} /></label>
            </div>
            <button type="submit" className="mt-4 min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg">保存套餐</button>
          </form>
          <ul className="mt-4">
            {plans.map((plan) => (
              <li key={plan.id} className="mt-3 rounded-xl border border-line bg-surface p-4 text-sm">
                <p className="font-medium">{plan.name} · {yuan(plan.priceCents)} · {plan.durationDays} 天{plan.active ? "" : " · 已下架"}</p>
                <p className="mt-1 text-muted">源工程 {plan.generation} · 下载 {plan.export} · 打包 {plan.build}+每月 {plan.monthlyBuild} · 工程上限 {plan.projectLimit === 0 ? "不限" : plan.projectLimit}</p>
                <button type="button" className={`${ghost} mt-3`} onClick={() => void call("adminSavePlan", { plan: { ...plan, active: !plan.active } }).then(bump).catch((reason) => setError(errorText(reason)))}>
                  {plan.active ? "下架套餐" : "重新上架"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "卡密" ? (
        <div className="mt-5">
          <form
            className="rounded-xl border border-line bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const payload = keyForm.type === "membership"
                ? { planId: keyForm.planId }
                : keyForm.type === "component"
                  ? { componentId: keyForm.componentId }
                  : keyForm.type === "quota"
                    ? { generation: Number(keyForm.generation), export: Number(keyForm.export), build: Number(keyForm.build) }
                    : { planId: keyForm.planId, componentId: keyForm.componentId, generation: Number(keyForm.generation), export: Number(keyForm.export) };
              void call<{ codes: string[] }>("adminCreateKeys", { ...keyForm, quantity: Number(keyForm.quantity), payload })
                .then((result) => {
                  setFreshCodes(result.codes);
                  bump();
                })
                .catch((reason) => setError(errorText(reason)));
            }}
          >
            <h2 className="font-semibold">生成批次</h2>
            <p className="mt-1 text-sm text-muted">明文只在这次结果显示，数据库只存哈希。</p>
            <label className="mt-3 block text-sm text-muted">类型
              <select value={keyForm.type} onChange={(event) => setKeyForm({ ...keyForm, type: event.target.value })} className={field}>
                <option value="membership">membership 会员</option>
                <option value="quota">quota 额度</option>
                <option value="component">component 组件</option>
                <option value="custom">custom 组合</option>
              </select>
            </label>
            <label className="mt-3 block text-sm text-muted">标题<input value={keyForm.title} onChange={(event) => setKeyForm({ ...keyForm, title: event.target.value })} className={field} /></label>
            <label className="mt-3 block text-sm text-muted">数量<input value={keyForm.quantity} onChange={(event) => setKeyForm({ ...keyForm, quantity: event.target.value })} className={field} /></label>
            <label className="mt-3 block text-sm text-muted">有效天数，0 为不过期<input value={keyForm.expiresInDays} onChange={(event) => setKeyForm({ ...keyForm, expiresInDays: event.target.value })} className={field} /></label>
            <button type="submit" className="mt-4 min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg">生成并显示一次</button>
          </form>
          {freshCodes.length ? (
            <textarea readOnly value={freshCodes.join("\n")} className="mt-4 min-h-32 w-full rounded-md border border-line bg-bg p-3 font-mono text-sm text-fg" />
          ) : null}
          <ul className="mt-4">
            {keys.map((item) => (
              <li key={item.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-3 text-sm">
                <span>{item.title} · {item.type} · {item.hint} · {item.status}</span>
                {item.status === "unused" ? (
                  <span className="flex gap-2">
                    <button type="button" className={ghost} onClick={() => void call("adminSetKey", { id: item.id, status: "frozen" }).then(bump).catch((reason) => setError(errorText(reason)))}>冻结</button>
                    <button type="button" className={ghost} onClick={() => void call("adminSetKey", { id: item.id, status: "void" }).then(bump).catch((reason) => setError(errorText(reason)))}>作废</button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "订单" ? (
        <ul className="mt-5">
          {orders.map((order) => (
            <li key={order.id} className="mt-3 rounded-xl border border-line bg-surface p-4 text-sm">
              <p>{order.snapshot?.name ?? "套餐"} · {order.status} · {yuan(order.amountCents)}</p>
              <p className="mt-1 text-xs text-muted">{order.userId}</p>
              <p className="mt-1 text-muted">{order.note}</p>
              {order.status === "pending" ? (
                <div className="mt-3 flex gap-2">
                  <button type="button" className={ghost} onClick={() => void call("adminConfirmOrder", { id: order.id, decision: "confirm" }).then(bump).catch((reason) => setError(errorText(reason)))}>确认开通</button>
                  <button type="button" className={ghost} onClick={() => void call("adminConfirmOrder", { id: order.id, decision: "cancel" }).then(bump).catch((reason) => setError(errorText(reason)))}>取消</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {tab === "任务" ? (
        <ul className="mt-5">
          {jobs.map((job) => (
            <li key={job.id} className="mt-2 rounded-md border border-line px-3 py-3 text-sm">
              <span className="font-medium">{job.kind} · {job.status}</span>
              <span className="mt-1 block text-muted">{job.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {tab === "开关" ? (
        <ul className="mt-5">
          {CONFIG_KEYS.map((key) => (
            <li key={key} className="mt-2 flex items-center justify-between gap-3 rounded-md border border-line px-3 py-3 text-sm">
              <span>{key}</span>
              <button type="button" className={ghost} onClick={() => void call("adminSetConfig", { key, value: flags[key] === "true" ? "false" : "true" }).then(() => setFlags({ ...flags, [key]: flags[key] === "true" ? "false" : "true" })).catch((reason) => setError(errorText(reason)))}>
                {flags[key] === "true" ? "开" : "关"}
              </button>
            </li>
          ))}
          <li className="mt-3 text-sm leading-6 text-muted">build_enabled 可以记录运营意图，服务端仍拒绝把未验证编译标成成功。</li>
        </ul>
      ) : null}

      {tab === "公告" ? (
        <div className="mt-5">
          <form className="rounded-xl border border-line bg-surface p-4" onSubmit={(event) => {
            event.preventDefault();
            void call("adminSaveAnnouncement", { title: draftTitle, body: draftBody, active: true }).then(() => {
              setDraftTitle("");
              setDraftBody("");
              bump();
            }).catch((reason) => setError(errorText(reason)));
          }}>
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="标题" className={field} />
            <textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} placeholder="正文" className="mt-3 min-h-24 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg" />
            <button type="submit" className="mt-3 min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg">发布</button>
          </form>
          <ul className="mt-4">
            {announcements.map((item) => (
              <li key={item.id} className="mt-2 rounded-md border border-line px-3 py-3 text-sm">
                <span className="font-medium">{item.title}</span>
                <span className="mt-1 block text-muted">{item.body}</span>
                <button type="button" className={`${ghost} mt-2`} onClick={() => void call("adminSaveAnnouncement", { id: item.id, title: item.title, body: item.body, active: !item.active }).then(bump).catch((reason) => setError(errorText(reason)))}>
                  {item.active ? "停用" : "启用"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "版本" ? (
        <div className="mt-5">
          <form
            className="rounded-xl border border-line bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void call("adminSaveRelease", {
                release: {
                  versionName: releaseForm.versionName.trim(),
                  versionCode: Number(releaseForm.versionCode),
                  minVersionCode: Number(releaseForm.minVersionCode),
                  notes: releaseForm.notes,
                  apkUrl: releaseForm.apkUrl.trim(),
                  sha256: releaseForm.sha256.trim(),
                  channel: releaseForm.channel,
                  force: releaseForm.force,
                  active: true,
                },
              }).then(bump).catch((reason) => setError(errorText(reason)));
            }}
          >
            <h2 className="font-semibold">客户端版本</h2>
            <p className="mt-1 text-sm text-muted">这里登记网页、Android、桌面共用的版本说明。没有真实安装包地址时不要填。更新包必须是 https，客户端安装仍走系统授权，不能绕过。</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-sm text-muted">版本名<input value={releaseForm.versionName} onChange={(event) => setReleaseForm({ ...releaseForm, versionName: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">版本号<input value={releaseForm.versionCode} onChange={(event) => setReleaseForm({ ...releaseForm, versionCode: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">最低可用版本<input value={releaseForm.minVersionCode} onChange={(event) => setReleaseForm({ ...releaseForm, minVersionCode: event.target.value })} className={field} /></label>
              <label className="text-sm text-muted">渠道
                <select value={releaseForm.channel} onChange={(event) => setReleaseForm({ ...releaseForm, channel: event.target.value })} className={field}>
                  <option value="stable">正式</option>
                  <option value="beta">测试</option>
                </select>
              </label>
            </div>
            <label className="mt-3 block text-sm text-muted">说明<textarea value={releaseForm.notes} onChange={(event) => setReleaseForm({ ...releaseForm, notes: event.target.value })} className={`${field} min-h-20`} /></label>
            <label className="mt-3 block text-sm text-muted">安装包地址<input value={releaseForm.apkUrl} onChange={(event) => setReleaseForm({ ...releaseForm, apkUrl: event.target.value })} className={field} /></label>
            <label className="mt-3 block text-sm text-muted">SHA-256<input value={releaseForm.sha256} onChange={(event) => setReleaseForm({ ...releaseForm, sha256: event.target.value })} className={field} /></label>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={releaseForm.force} onChange={(event) => setReleaseForm({ ...releaseForm, force: event.target.checked })} />强制更新</label>
            <button type="submit" className="mt-3 min-h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg">发布版本记录</button>
          </form>
          <ul className="mt-4">
            {releases.map((item) => (
              <li key={item.id} className="mt-3 rounded-xl border border-line bg-surface p-4 text-sm">
                <p className="font-medium">{item.versionName} · {item.versionCode} · {item.channel === "beta" ? "测试" : "正式"}{item.force ? " · 强制" : ""}{item.active ? "" : " · 停用"}</p>
                <p className="mt-1 text-muted">{item.notes || "没有说明"}</p>
                {item.apkUrl ? <p className="mt-1 truncate font-mono text-xs text-muted">{item.apkUrl}</p> : <p className="mt-1 text-xs text-warn">还没有安装包地址</p>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "审计" ? (
        <ul className="mt-5">
          {audit.map((row) => (
            <li key={row.id} className="mt-2 text-sm">
              <span className="font-mono text-xs text-muted">{row.createdAt ? new Date(row.createdAt).toLocaleString() : ""}</span>
              <span className="ml-2">{row.action}</span>
              <span className="mt-1 block truncate text-xs text-muted">{row.target}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
