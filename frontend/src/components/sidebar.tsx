"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Cctv,
  ScanFace,
  Bell,
  SlidersHorizontal,
  Film,
  BarChart3,
  Users,
  IdCard,
  Settings,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { useAuth, userName, userInitial } from "@/lib/auth";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/live-cameras", label: "Live Cameras", icon: Cctv },
  { href: "/ai-detection", label: "AI Detection", icon: ScanFace },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/camera-mgmt", label: "Camera Mgmt", icon: SlidersHorizontal },
  { href: "/employees", label: "Employees", icon: IdCard },
  { href: "/recordings", label: "Recordings", icon: Film },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/users", label: "Users", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-app bg-elev h-screen sticky top-0">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-app">
        <div className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-brand-light shadow-lg shadow-brand/20">
          <ShieldCheck className="w-5 h-5 text-white" />
        </div>
        <div className="leading-tight">
          <div className="font-bold text-sm">AI CCTV</div>
          <div className="text-[11px] text-muted">Security Monitor</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-brand/10 text-brand"
                  : "text-muted hover:bg-app hover:text-main"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-brand" />
              )}
              <Icon className="w-[18px] h-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User card + logout */}
      <div className="border-t border-app p-3 space-y-1">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <div className="grid place-items-center w-9 h-9 rounded-full bg-gradient-to-br from-brand to-brand-light text-white text-sm font-semibold">
            {userInitial(auth)}
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{userName(auth)}</div>
            <div className="text-[11px] text-muted">{auth.role}</div>
          </div>
        </div>
        <button
          onClick={() => {
            try {
              localStorage.removeItem("auth");
            } catch {
              /* ignore */
            }
            router.push("/login");
          }}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="w-[18px] h-[18px]" />
          Logout
        </button>
      </div>
    </aside>
  );
}
