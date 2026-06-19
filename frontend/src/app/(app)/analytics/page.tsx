"use client";

import { Card, StatusBadge } from "@/components/ui";
import { DetectionsBarChart, CameraUptimeChart } from "@/components/charts";
import { getAnalytics, type ApiAnalytics } from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";

export default function AnalyticsPage() {
  const { data, error } = useFetch<ApiAnalytics>(getAnalytics);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted text-sm mt-1">Detection trends and camera performance</p>
      </div>

      {error && <Card className="p-10 text-center text-muted">Couldn’t reach the API. Is the backend running?</Card>}

      {!error && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <h2 className="font-semibold">Detections Over Time</h2>
              <p className="text-xs text-muted mt-0.5 mb-4">Daily detection counts — last 7 days</p>
              {data ? <DetectionsBarChart data={data.byDay} /> : <div className="h-[300px] grid place-items-center text-muted text-sm">Loading…</div>}
            </Card>
            <Card className="p-5">
              <h2 className="font-semibold">Camera Uptime</h2>
              <p className="text-xs text-muted mt-0.5 mb-4">Uptime % per camera</p>
              {data ? <CameraUptimeChart data={data.cameraUptime} /> : <div className="h-[300px] grid place-items-center text-muted text-sm">Loading…</div>}
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="p-5 pb-0">
              <h2 className="font-semibold">Performance Summary</h2>
              <p className="text-xs text-muted mt-0.5">Per-camera detection and uptime metrics</p>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-app">
                    <th className="font-medium px-5 py-3">Camera</th>
                    <th className="font-medium px-5 py-3">Detections</th>
                    <th className="font-medium px-5 py-3">Uptime</th>
                    <th className="font-medium px-5 py-3">Alerts</th>
                    <th className="font-medium px-5 py-3">Resolution</th>
                    <th className="font-medium px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {(data?.performance ?? []).map((p) => (
                    <tr key={p.camera} className="hover:bg-app transition-colors">
                      <td className="px-5 py-3 font-medium">{p.camera}</td>
                      <td className="px-5 py-3 text-muted tabular-nums">{p.detections.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-app overflow-hidden">
                            <div
                              className={`h-full rounded-full ${p.uptime >= 95 ? "bg-emerald-500" : p.uptime >= 90 ? "bg-amber-500" : "bg-red-500"}`}
                              style={{ width: `${p.uptime}%` }}
                            />
                          </div>
                          <span className="text-muted tabular-nums text-xs">{p.uptime}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted tabular-nums">{p.alerts}</td>
                      <td className="px-5 py-3 text-muted">{p.resolution}</td>
                      <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                    </tr>
                  ))}
                  {data && data.performance.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-10 text-center text-muted">No cameras yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
