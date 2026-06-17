"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "@/components/theme-provider";

function useAxis() {
  const { theme } = useTheme();
  const grid = theme === "dark" ? "#1f2a44" : "#e6eaf1";
  const tick = theme === "dark" ? "#8595b0" : "#64748b";
  return { grid, tick };
}

const tooltipStyle = (theme: string) => ({
  backgroundColor: theme === "dark" ? "#0d1220" : "#ffffff",
  border: `1px solid ${theme === "dark" ? "#1f2a44" : "#e6eaf1"}`,
  borderRadius: 10,
  fontSize: 12,
  color: theme === "dark" ? "#e6edf7" : "#0f1729",
});

export interface ActivityPoint {
  label: string;
  intrusion: number;
  sleeping: number;
  mobile: number;
}

export function DetectionActivityChart({ data }: { data: ActivityPoint[] }) {
  const { theme } = useTheme();
  const { grid, tick } = useAxis();
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="gIntrusion" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f0455f" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#f0455f" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gSleeping" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gMobile" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-brand)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--color-brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" stroke={tick} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={tick} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle(theme)} />
        <Area type="monotone" dataKey="intrusion" stroke="#f0455f" strokeWidth={2} fill="url(#gIntrusion)" />
        <Area type="monotone" dataKey="sleeping" stroke="#f59e0b" strokeWidth={2} fill="url(#gSleeping)" />
        <Area type="monotone" dataKey="mobile" stroke="var(--color-brand)" strokeWidth={2} fill="url(#gMobile)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DetectionsBarChart({ data }: { data: { day: string; count: number }[] }) {
  const { theme } = useTheme();
  const { grid, tick } = useAxis();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="day" stroke={tick} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={tick} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle(theme)} cursor={{ fill: theme === "dark" ? "#ffffff08" : "#00000008" }} />
        <Bar dataKey="count" fill="url(#gBar)" radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CameraUptimeChart({ data }: { data: { camera: string; uptime: number }[] }) {
  const { theme } = useTheme();
  const { grid, tick } = useAxis();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} stroke={tick} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="camera"
          stroke={tick}
          fontSize={11}
          width={90}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={tooltipStyle(theme)} cursor={{ fill: theme === "dark" ? "#ffffff08" : "#00000008" }} />
        <Bar dataKey="uptime" radius={[0, 6, 6, 0]} maxBarSize={22}>
          {data.map((_, i) => (
            <Cell key={i} fill="var(--color-brand)" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
