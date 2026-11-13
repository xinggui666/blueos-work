/** 管理后台共用的小组件。 */
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface p-4 text-sm ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <p className="rounded-xl border border-line bg-surface px-4 py-4 text-sm" data-testid={`stat-${label}`}>
      <span className="block text-muted">{label}</span>
      <span className="mt-1 block text-2xl font-semibold">{value}</span>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </p>
  );
}

