"use client";

import { useState } from "react";
import { Check, MapPin, Trash2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Card, FilterTabs, SeverityBadge } from "@/components/ui";
import { useAlerts } from "@/lib/use-alerts";
import { cn } from "@/lib/utils";

type Tab = "all" | "Unresolved" | "Resolved";

export default function AlertsPage() {
  const [tab, setTab] = useState<Tab>("all");
  const { alerts, conn, resolve, remove, refresh } = useAlerts();

  const rows = alerts.filter((a) => (tab === "all" ? true : a.status === tab));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Alert History</h1>
          <p className="text-muted text-sm mt-1 flex items-center gap-2">
            All security alerts across cameras
            {conn === "live" ? (
              <span className="inline-flex items-center gap-1 text-emerald-500 text-xs font-medium">
                <Wifi className="w-3.5 h-3.5" /> Live
              </span>
            ) : conn === "offline" ? (
              <span className="inline-flex items-center gap-1 text-amber-500 text-xs font-medium">
                <WifiOff className="w-3.5 h-3.5" /> Offline (mock data)
              </span>
            ) : (
              <span className="text-muted text-xs">connecting…</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refresh}
            className="grid place-items-center w-9 h-9 rounded-lg border border-app text-muted hover:bg-app hover:text-main transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <FilterTabs<Tab>
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "all", label: "All" },
              { key: "Unresolved", label: "Unresolved" },
              { key: "Resolved", label: "Resolved" },
            ]}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-app">
                <th className="font-medium px-4 py-3">Type</th>
                <th className="font-medium px-4 py-3">Camera</th>
                <th className="font-medium px-4 py-3">Location</th>
                <th className="font-medium px-4 py-3">Severity</th>
                <th className="font-medium px-4 py-3">Time</th>
                <th className="font-medium px-4 py-3">Status</th>
                <th className="font-medium px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-app transition-colors">
                  <td className="px-4 py-3 font-medium">{a.type}</td>
                  <td className="px-4 py-3 text-muted">{a.camera}</td>
                  <td className="px-4 py-3 text-muted">
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {a.location}</span>
                  </td>
                  <td className="px-4 py-3"><SeverityBadge severity={a.severity} /></td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{a.time}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                        a.status === "Resolved"
                          ? "bg-emerald-500/10 text-emerald-500"
                          : "bg-amber-500/10 text-amber-500"
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full", a.status === "Resolved" ? "bg-emerald-500" : "bg-amber-500")} />
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {a.status === "Unresolved" && (
                        <button
                          onClick={() => resolve(a.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-app px-2.5 py-1 text-xs font-medium hover:bg-brand hover:text-white hover:border-transparent transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" /> Resolve
                        </button>
                      )}
                      <button
                        onClick={() => remove(a.id)}
                        className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted">
                    No alerts to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
