import { cn } from "@/lib/utils";
import type { Severity, CamStatus } from "@/lib/data";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-card border border-app rounded-xl shadow-sm",
        "shadow-black/5 dark:shadow-black/20",
        className
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted text-sm mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span className={cn("inline-block w-2 h-2 rounded-full", className)} />;
}

const severityStyles: Record<Severity, string> = {
  critical: "bg-red-500/10 text-red-500 dark:text-red-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  normal: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

const severityDot: Record<Severity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  normal: "bg-emerald-500",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const label = severity.charAt(0).toUpperCase() + severity.slice(1);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        severityStyles[severity]
      )}
    >
      <Dot className={severityDot[severity]} />
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: CamStatus }) {
  const online = status === "online";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        online
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-red-500/10 text-red-500 dark:text-red-400"
      )}
    >
      <Dot className={online ? "bg-emerald-500" : "bg-red-500"} />
      {online ? "Live" : "Offline"}
    </span>
  );
}

export function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-app px-3 py-1 text-xs font-medium",
        className
      )}
    >
      {children}
    </span>
  );
}

export function FilterTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-app border border-app p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === t.key
              ? "bg-brand text-white shadow-sm"
              : "text-muted hover:text-main"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    Admin: "bg-brand/10 text-brand",
    "Security Manager": "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    Employee: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        map[role] ?? map.Employee
      )}
    >
      {role}
    </span>
  );
}
