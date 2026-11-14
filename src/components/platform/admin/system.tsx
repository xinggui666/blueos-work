import { useState } from "react";
import { CONFIG_KEYS } from "@/lib/platform/policy";
import { Card } from "./ui";
import { act, field, ghost, primary, useAdmin, when } from "./lib";

const FLAG_TEXT: Record<string, string> = {
  registration_open: "开放注册",
  marketplace_open: "组件商城",
  membership_open: "会员购买",
  keys_open: "卡密兑换",
  submissions_open: "组件投稿",
  auto_publish: "投稿机器检查通过后自动上架",
  generation_enabled: "源工程生成",
  export_enabled: "工程下载（.bproj）",
  build_enabled: "RPK 构建",
  announcements_enabled: "显示公告",
  maintenance_mode: "维护模式（普通用户只读）",
};

export function FlagsTab({ onError }: { onError: (t: string) => void }) {
  const [flags, reload] = useAdmin<Record<string, string>>("adminConfig", {}, onError);
  return (
    <Card className="mt-5">
      <ul>
        {CONFIG_KEYS.map((key) => (
          <li key={key} className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
            <span>
              {FLAG_TEXT[key] ?? key} <span className="font-mono text-xs text-muted">{key}</span>
            </span>
            <button type="button" aria-label={`切换 ${key}`} className={ghost} onClick={() => act(onError, "adminSetConfig", { key, value: flags?.[key] === "true" ? "false" : "true" }, reload)}>
              {flags?.[key] === "true" ? "已开" : "已关"}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-5 text-muted">
        开关只影响服务器上的操作。已经生成的 RPK 在手表上独立运行，不读取远程配置；服务器或远程配置不可用时它们照常工作。维护模式下管理员不受限制。
      </p>
    </Card>
  );
}

type Release = {
  id: string;
  channel: string;
  versionName: string;
  versionCode: number;
  minVersionCode: number;
  force: boolean;
  notes: string;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  active: boolean;
  rolloutPercent: number;
  publishedAt: string | null;
  downloadable: boolean;
};
const EMPTY = { id: "", versionName: "", versionCode: "", minVersionCode: "1", notes: "", apkUrl: "", sha256: "", sizeBytes: "0", channel: "stable", force: false, rolloutPercent: "100", publishedAt: "", active: true };

export function ReleasesTab({ onError }: { onError: (t: string) => void }) {
  const [rows, reload] = useAdmin<Release[]>("adminReleases", {}, onError);
  const [f, setF] = useState(EMPTY);
  const text = (key: keyof typeof EMPTY, label: string, placeholder = "") => (
    <label className="text-muted">
      {label}
      <input value={String(f[key])} placeholder={placeholder} onChange={(e) => setF({ ...f, [key]: e.target.value })} className={field} />
    </label>
  );
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <Card>
        <p className="font-semibold">{f.id ? "编辑版本" : "登记新版本"}</p>
        <p className="mt-1 text-muted">没有真实安装包时不要填地址，客户端会显示“不可下载”。地址只接受 https，填地址必须同时填 SHA-256。</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {text("versionName", "版本名", "1.0.0")}
          {text("versionCode", "版本号", "1")}
          {text("minVersionCode", "最低支持版本号")}
          <label className="text-muted">
            渠道
            <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className={field}>
              <option value="stable">正式版</option>
              <option value="beta">测试版</option>
            </select>
          </label>
          {text("rolloutPercent", "灰度比例 %（100 = 全量）")}
          <label className="text-muted">
            发布时间（留空 = 立即）
            <input type="datetime-local" value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} className={field} />
          </label>
          {text("apkUrl", "APK 地址", "https://…")}
          {text("sha256", "SHA-256")}
          {text("sizeBytes", "大小（字节）")}
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={f.force} onChange={(e) => setF({ ...f, force: e.target.checked })} />
            强制更新
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            启用
          </label>
        </div>
        <label className="mt-2 block text-muted">
          更新说明
          <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={`${field} min-h-20 py-2`} />
        </label>
        <button
          type="button"
          className={`${primary} mt-3`}
          onClick={() =>
            act(
              onError,
              "adminSaveRelease",
              {
                release: {
                  ...f,
                  id: f.id || undefined,
                  versionCode: Number(f.versionCode),
                  minVersionCode: Number(f.minVersionCode),
                  sizeBytes: Number(f.sizeBytes),
                  rolloutPercent: Number(f.rolloutPercent),
                  publishedAt: f.publishedAt ? new Date(f.publishedAt).toISOString() : "",
                },
              },
              () => {
                setF(EMPTY);
                reload();
              },
            )
          }
        >
          保存
        </button>
      </Card>
      <ul className="grid content-start gap-2">
        {(rows ?? []).map((r) => (
          <li key={r.id}>
            <Card>
              <p className="font-medium">
                {r.versionName}（{r.versionCode}）· {r.channel === "beta" ? "测试版" : "正式版"}
                {r.force ? " · 强制更新" : " · 普通更新"}
                {r.active ? "" : " · 已停用"}
              </p>
              <p className="mt-1 text-muted">
                最低支持 {r.minVersionCode} · 灰度 {r.rolloutPercent}% · 发布时间 {r.publishedAt ? when(r.publishedAt) : "立即"}
              </p>
              {r.downloadable ? <p className="mt-1 break-all font-mono text-xs text-muted">{r.apkUrl} · {r.sha256}</p> : <p className="mt-1 text-warn">没有真实安装包，客户端显示不可下载</p>}
              <p className="mt-1 text-muted">{r.notes || "没有说明"}</p>
              <button
                type="button"
                className={`${ghost} mt-2`}
                onClick={() =>
                  setF({
                    id: r.id,
                    versionName: r.versionName,
                    versionCode: String(r.versionCode),
                    minVersionCode: String(r.minVersionCode),
                    notes: r.notes,
                    apkUrl: r.apkUrl,
                    sha256: r.sha256,
                    sizeBytes: String(r.sizeBytes),
                    channel: r.channel,
                    force: r.force,
                    rolloutPercent: String(r.rolloutPercent),
                    publishedAt: r.publishedAt ? r.publishedAt.slice(0, 16) : "",
                    active: r.active,
                  })
                }
              >
                编辑
              </button>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnnouncementsTab({ onError }: { onError: (t: string) => void }) {
  const [rows, reload] = useAdmin<{ id: string; title: string; body: string; active: boolean; createdAt: string | null }[]>("adminAnnouncements", {}, onError);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="mt-5 grid gap-3">
      <Card>
        <input aria-label="公告标题" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" className={field} />
        <textarea aria-label="公告正文" value={body} onChange={(e) => setBody(e.target.value)} placeholder="正文" className={`${field} min-h-24 py-2`} />
        <button
          type="button"
          className={`${primary} mt-2`}
          onClick={() =>
            act(onError, "adminSaveAnnouncement", { title, body, active: true }, () => {
              setTitle("");
              setBody("");
              reload();
            })
          }
        >
          发布
        </button>
      </Card>
      {(rows ?? []).map((a) => (
        <Card key={a.id}>
          <p className="font-medium">
            {a.title}
            {a.active ? "" : "（已停用）"}
          </p>
          <p className="mt-1 text-muted">{a.body}</p>
          <button type="button" className={`${ghost} mt-2`} onClick={() => act(onError, "adminSaveAnnouncement", { id: a.id, title: a.title, body: a.body, active: !a.active }, reload)}>
            {a.active ? "停用" : "启用"}
          </button>
        </Card>
      ))}
    </div>
  );
}

export function AuditTab({ onError }: { onError: (t: string) => void }) {
  const [rows] = useAdmin<{ id: string; actorId: string; action: string; target: string; before: unknown; after: unknown; createdAt: string | null }[]>("adminAudit", {}, onError);
  return (
    <Card className="mt-5">
      <ul>
        {(rows ?? []).map((r) => (
          <li key={r.id} className="border-b border-line py-2 last:border-0">
            <span className="font-mono text-xs text-muted">{when(r.createdAt)}</span> <span className="font-medium">{r.action}</span>
            <span className="block break-all text-xs text-muted">
              操作人 {r.actorId} · 对象 {r.target} · {r.after ? JSON.stringify(r.after).slice(0, 200) : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProjectAssetsTab({ onError }: { onError: (text: string) => void }) {
  const [rows, reload] = useAdmin<
    { user_id: string; sha256: string; bytes: number; mime: string; created_at: string }[]
  >("adminProjectAssets", {}, onError);
  return (
    <Card className="mt-5">
      <h2 className="font-semibold">工程二进制资源（最近 100 条）</h2>
      <p className="mt-2 text-sm text-muted">
        只读清单：不提供代用户下载、改写或删除；资源被历史修订引用时必须保留。账号普通资源配额
        20MiB，会员按不可变授权快照。此处不是商城组件附件。
      </p>
      <button type="button" className={ghost} onClick={reload}>
        刷新资源清单
      </button>
      <ul>
        {rows?.map((row) => (
          <li
            className="mt-2 break-all border-t border-line py-2 text-xs"
            key={`${row.user_id}:${row.sha256}`}
          >
            {row.user_id} · {row.mime} · {row.bytes} 字节 · {when(row.created_at)}
            <br />
            <code>{row.sha256}</code>
          </li>
        ))}
      </ul>
    </Card>
  );
}
