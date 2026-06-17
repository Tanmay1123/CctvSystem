"use client";

import Link from "next/link";
import {
  Camera,
  TriangleAlert,
  Footprints,
  Users as UsersIcon,
  ScanFace,
  PackageSearch,
} from "lucide-react";
import { useAlerts } from "@/lib/use-alerts";
import type { Severity } from "@/lib/data";

const alertIcons: Record<string, typeof Camera> = {
  "Intrusion Detected": TriangleAlert,
  "Motion Detected": Footprints,
  "Person Detected": UsersIcon,
  "Face Recognition": ScanFace,
  "Object Detected": PackageSearch,
};

const severityColor: Record<Severity, string> = {
  critical: "text-red-500 bg-red-500/10",
  warning: "text-amber-500 bg-amber-500/10",
  normal: "text-emerald-500 bg-emerald-500/10",
};

export function RecentAlerts() {
  const { alerts, conn } = useAlerts();
  const unresolved = alerts.filter((a) => a.status === "Unresolved");
  const recent = alerts.slice(0, 5);

  return (
    <>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-semibold">Recent Alerts</h2>
          <p className="text-xs text-muted mt-0.5">
            {unresolved.length} unresolved
            {conn === "offline" && " • offline"}
          </p>
        </div>
        <Link href="/alerts" className="text-xs font-medium text-brand hover:text-brand-light">
          View All
        </Link>
      </div>
      <ul className="space-y-2">
        {recent.map((a) => {
          const Icon = alertIcons[a.type] ?? Camera;
          return (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-app transition-colors"
            >
              <div className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 ${severityColor[a.severity]}`}>
                <Icon className="w-[18px] h-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{a.type}</div>
                <div className="text-xs text-muted truncate">{a.location} • {a.time}</div>
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${severityColor[a.severity]}`}>
                {a.severity}
              </span>
            </li>
          );
        })}
        {recent.length === 0 && (
          <li className="text-sm text-muted text-center py-8">No alerts yet.</li>
        )}
      </ul>
    </>
  );
}
