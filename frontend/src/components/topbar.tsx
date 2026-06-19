"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Settings, Moon, Sun, Activity } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useAlerts } from "@/lib/use-alerts";
import { useAuth, userName, userInitial } from "@/lib/auth";
import { Pill, Dot } from "@/components/ui";
import type { Severity } from "@/lib/data";

const sevDot: Record<Severity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  normal: "bg-emerald-500",
};

export function Topbar() {
  const { theme, toggle } = useTheme();
  const { alerts } = useAlerts();
  const auth = useAuth();
  const [clock, setClock] = useState("");

  const name = userName(auth);
  const role = auth.role;
  const avatarInitial = userInitial(auth);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const unresolved = alerts.filter((a) => a.status === "Unresolved");

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Close the notifications dropdown on outside click / Escape.
  useEffect(() => {
    if (!bellOpen) return;
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBellOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [bellOpen]);

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 h-16 px-4 sm:px-6 border-b border-app bg-elev/80 backdrop-blur">
      {/* Status pills */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <Pill className="bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
          <Dot className="bg-emerald-500 animate-pulse" />
          SYSTEM ONLINE
        </Pill>
        <Pill className="hidden sm:inline-flex text-muted">5 / 6 Cameras</Pill>
        <Pill className="hidden lg:inline-flex bg-brand/10 border-brand/20 text-brand">
          <Activity className="w-3.5 h-3.5" />
          AI Monitoring Active
        </Pill>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-1 sm:gap-2">
        <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted tabular-nums px-2">
          <Activity className="w-3.5 h-3.5 text-brand" />
          {clock}
        </span>

        <Link
          href="/settings"
          aria-label="Settings"
          className="grid place-items-center w-9 h-9 rounded-lg text-muted hover:bg-app hover:text-main transition-colors"
        >
          <Settings className="w-[18px] h-[18px]" />
        </Link>

        {/* Notifications */}
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => setBellOpen((v) => !v)}
            aria-label="Notifications"
            aria-expanded={bellOpen}
            className="relative grid place-items-center w-9 h-9 rounded-lg text-muted hover:bg-app hover:text-main transition-colors"
          >
            <Bell className="w-[18px] h-[18px]" />
            {unresolved.length > 0 && (
              <span className="absolute top-1 right-1 grid place-items-center min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold">
                {unresolved.length > 9 ? "9+" : unresolved.length}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-xl border border-app bg-card shadow-lg shadow-black/10 dark:shadow-black/30 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-app">
                <span className="text-sm font-semibold">Notifications</span>
                <span className="text-[11px] text-muted">{unresolved.length} unresolved</span>
              </div>
              <ul className="max-h-80 overflow-y-auto divide-y divide-[var(--border)]">
                {unresolved.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <Link
                      href="/alerts"
                      onClick={() => setBellOpen(false)}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-app transition-colors"
                    >
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sevDot[a.severity]}`} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{a.type}</span>
                        <span className="block text-xs text-muted truncate">{a.location} • {a.time}</span>
                      </span>
                    </Link>
                  </li>
                ))}
                {unresolved.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-muted">You’re all caught up.</li>
                )}
              </ul>
              <Link
                href="/alerts"
                onClick={() => setBellOpen(false)}
                className="block px-4 py-3 text-center text-xs font-medium text-brand hover:bg-app border-t border-app transition-colors"
              >
                View all alerts
              </Link>
            </div>
          )}
        </div>

        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="grid place-items-center w-9 h-9 rounded-lg text-muted hover:bg-app hover:text-main transition-colors"
        >
          {theme === "dark" ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
        </button>

        <div className="flex items-center gap-2 rounded-lg border border-app pl-1 pr-3 py-1 ml-1">
          <div className="grid place-items-center w-7 h-7 rounded-full bg-gradient-to-br from-brand to-brand-light text-white text-xs font-semibold">
            {avatarInitial}
          </div>
          <div className="hidden sm:block leading-tight">
            <div className="text-xs font-semibold">{name}</div>
            <div className="text-[10px] text-muted">{role}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
