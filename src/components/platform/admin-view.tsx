/** 管理后台（规格第十七章）。每个接口都在服务端检查权限，这里没有权限的标签页会显示服务端返回的“没有权限”。 */
import { useCallback, useState } from "react";
import { BuildsTab } from "./admin/builds";
import { KeysTab, OrdersTab, PlansTab } from "./admin/commerce";
import { ComponentsTab, SubmissionsTab } from "./admin/components";
import { OverviewTab } from "./admin/overview";
import { AnnouncementsTab, AuditTab, FlagsTab, ReleasesTab } from "./admin/system";
import { UsersTab } from "./admin/users";

const TABS = ["总览", "用户", "组件", "投稿", "套餐", "卡密", "订单", "构建", "版本", "开关", "公告", "审计"] as const;
type Tab = (typeof TABS)[number];

export function AdminView() {
  const [tab, setTab] = useState<Tab>("总览");
  const [error, setError] = useState("");
  const onError = useCallback((text: string) => setError(text), []);
  const props = { onError };
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="text-xl font-semibold">管理后台</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">所有操作都在服务端按角色检查权限，并写入审计记录。</p>
      <div className="studio-scroll mt-4 flex gap-2 overflow-x-auto" role="tablist">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={`shrink-0 rounded-md px-3 py-2 text-sm ${tab === item ? "bg-accent text-accent-fg" : "border border-line text-muted"}`}
            onClick={() => {
              setError("");
              setTab(item);
            }}
          >
            {item}
          </button>
        ))}
      </div>
      {error ? (
        <p className="mt-4 text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      {tab === "总览" ? <OverviewTab {...props} /> : null}
      {tab === "用户" ? <UsersTab {...props} /> : null}
      {tab === "组件" ? <ComponentsTab {...props} /> : null}
      {tab === "投稿" ? <SubmissionsTab {...props} /> : null}
      {tab === "套餐" ? <PlansTab {...props} /> : null}
      {tab === "卡密" ? <KeysTab {...props} /> : null}
      {tab === "订单" ? <OrdersTab {...props} /> : null}
      {tab === "构建" ? <BuildsTab {...props} /> : null}
      {tab === "版本" ? <ReleasesTab {...props} /> : null}
      {tab === "开关" ? <FlagsTab {...props} /> : null}
      {tab === "公告" ? <AnnouncementsTab {...props} /> : null}
      {tab === "审计" ? <AuditTab {...props} /> : null}
    </main>
  );
}
