"use client";

import { useState } from "react";
import {
  ScanFace,
  Footprints,
  Users as UsersIcon,
  Smartphone,
  TriangleAlert,
  MapPin,
  Clock,
  Film,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Card, FilterTabs, SeverityBadge } from "@/components/ui";
import { useAlerts } from "@/lib/use-alerts";
import type { Severity } from "@/lib/data";

type Tab = "all" | Severity;

const eventIcons: Record<string, typeof ScanFace> = {
  intrusion: TriangleAlert,
  sleeping: Footprints,
  mobile: Smartphone,
  crowd: UsersIcon,
};

function iconFor(type: string) {
  const t = type.toLowerCase();
  if (t.includes("intrusion")) return eventIcons.intrusion;
  if (t.includes("sleep")) return eventIcons.sleeping;
  if (t.includes("mobile")) return eventIcons.mobile;
  if (t.includes("crowd")) return eventIcons.crowd;
  return ScanFace;
}

const iconColor: Record<Severity, string> = {
  critical: "text-red-500 bg-red-500/10",
  warning: "text-amber-500 bg-amber-500/10",
  normal: "text-emerald-500 bg-emerald-500/10",
};

export default function AiDetectionPage() {
  const [tab, setTab] = useState<Tab>("all");
  const { alerts, conn } = useAlerts();

  const filtered = alerts.filter((d) => (tab === "all" ? true : d.severity === tab));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Detection</h1>
          <p className="text-muted text-sm mt-1 flex items-center gap-2">
            Detection events from the AI engine
            {conn === "live" ? (
              <span className="inline-flex items-center gap-1 text-emerald-500 text-xs font-medium">
                <Wifi className="w-3.5 h-3.5" /> Live
              </span>
            ) : conn === "offline" ? (
              <span className="inline-flex items-center gap-1 text-amber-500 text-xs font-medium">
                <WifiOff className="w-3.5 h-3.5" /> Offline
              </span>
            ) : null}
          </p>
        </div>
        <FilterTabs<Tab>
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "all", label: "All" },
            { key: "critical", label: "Critical" },
            { key: "warning", label: "Warning" },
            { key: "normal", label: "Normal" },
          ]}
        />
      </div>

      <Card className="divide-y divide-[var(--border)]">
        {filtered.map((d) => {
          const Icon = iconFor(d.type);
          return (
            <div key={d.id} className="flex items-center gap-4 p-4 hover:bg-app transition-colors">
              <div className={`grid place-items-center w-11 h-11 rounded-lg shrink-0 ${iconColor[d.severity]}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{d.type}</div>
                <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {d.camera}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {d.time}</span>
                </div>
              </div>
              {d.screenshot && (
                <a
                  href={d.screenshot}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-app px-2.5 py-1 text-xs font-medium text-muted hover:text-main hover:bg-app transition-colors"
                >
                  <Film className="w-3.5 h-3.5" /> {d.isVideo ? "Clip" : "Snapshot"}
                </a>
              )}
              <SeverityBadge severity={d.severity} />
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-12 text-center text-muted text-sm">
            {conn === "offline" ? "Backend offline — no detections." : "No detection events yet."}
          </div>
        )}
      </Card>
    </div>
  );
}
