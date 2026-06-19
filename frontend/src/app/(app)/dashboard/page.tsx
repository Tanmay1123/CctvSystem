"use client";

import Link from "next/link";
import {
  Cctv,
  Wifi,
  Users as UsersIcon,
  TriangleAlert,
  Activity,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui";
import { DetectionActivityChart } from "@/components/charts";
import { RecentAlerts } from "@/components/recent-alerts";
import { getStats, getAnalytics, type ApiStats, type ApiAnalytics } from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";

function todayLabel() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function DashboardPage() {
  const { data: stats } = useFetch<ApiStats>(getStats);
  const { data: analytics } = useFetch<ApiAnalytics>(getAnalytics);

  const cards = [
    { label: "Total Cameras", value: stats?.totalCameras ?? "—", note: "Installed", icon: Cctv, accent: "text-brand bg-brand/10" },
    { label: "Active Cameras", value: stats?.activeCameras ?? "—", note: `${stats?.offlineCameras ?? 0} offline`, icon: Wifi, accent: "text-emerald-400 bg-emerald-500/10" },
    { label: "Detections", value: stats?.peopleDetected ?? "—", note: "Total recorded", icon: UsersIcon, accent: "text-violet-400 bg-violet-500/10" },
    { label: "Daily Alerts", value: stats?.dailyAlerts ?? "—", note: `${stats?.unresolvedAlerts ?? 0} unresolved`, icon: TriangleAlert, accent: "text-red-400 bg-red-500/10" },
    { label: "Avg Uptime", value: stats ? `${stats.avgUptime}%` : "—", note: "Across cameras", icon: Activity, accent: "text-amber-400 bg-amber-500/10" },
    { label: "Security Score", value: stats ? `${stats.securityScore}/100` : "—", note: "Live", icon: ShieldCheck, accent: "text-brand bg-brand/10" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security Dashboard</h1>
        <p className="text-muted text-sm mt-1">Welcome back, Admin User • {todayLabel()}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="p-4">
              <div className={`grid place-items-center w-10 h-10 rounded-lg ${s.accent}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="mt-3 text-2xl font-bold tracking-tight">{s.value}</div>
              <div className="text-xs font-medium text-muted mt-0.5 uppercase tracking-wide">{s.label}</div>
              <div className="text-[11px] text-muted mt-0.5">{s.note}</div>
            </Card>
          );
        })}
      </div>

      {/* Chart + Recent alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-semibold">Detection Activity</h2>
              <p className="text-xs text-muted mt-0.5">Last 7 days — intrusion, sleeping, mobile usage</p>
            </div>
            <Link
              href="/analytics"
              className="flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-light"
            >
              Full Analytics <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {analytics ? (
            <DetectionActivityChart data={analytics.activity} />
          ) : (
            <div className="h-[280px] grid place-items-center text-muted text-sm">Loading…</div>
          )}
          <div className="flex items-center gap-5 mt-3 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> intrusion</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> sleeping</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-brand" /> mobile</span>
          </div>
        </Card>

        <Card className="p-5">
          <RecentAlerts />
        </Card>
      </div>
    </div>
  );
}
