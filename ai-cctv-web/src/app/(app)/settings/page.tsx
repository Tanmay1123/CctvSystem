"use client";

import { useEffect, useState } from "react";
import { User, Palette, Bell, Shield, Moon, Sun, Check, Eye, EyeOff, KeyRound } from "lucide-react";
import { Card } from "@/components/ui";
import { useTheme } from "@/components/theme-provider";
import { useAuth, userName, userInitial } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Tab = "profile" | "appearance" | "notifications" | "security";

const subnav: { key: Tab; label: string; icon: typeof User }[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "appearance", label: "Appearance", icon: Palette },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "security", label: "Security", icon: Shield },
];

function Field({
  label,
  value,
  onChange,
  readOnly,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={cn(
          "mt-1.5 w-full rounded-lg border border-app bg-app px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition",
          readOnly && "opacity-70 cursor-default focus:ring-0 focus:border-app"
        )}
      />
    </label>
  );
}

function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      onClick={() => setOn((v) => !v)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-colors",
        on ? "bg-brand" : "bg-slate-400/40"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
          on && "translate-x-5"
        )}
      />
    </button>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");
  const { theme, setTheme } = useTheme();
  const auth = useAuth();

  const [profile, setProfile] = useState({ fullName: "", email: "", role: "", phone: "" });

  // Populate the profile form from the current account.
  useEffect(() => {
    setProfile((p) => ({
      fullName: userName(auth),
      email: auth.email,
      role: auth.role,
      phone: p.phone,
    }));
  }, [auth]);

  const avatarInitial = userInitial(auth);

  // Security: current-password reveal.
  const [revealCurrent, setRevealCurrent] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted text-sm mt-1">
          Configure your AI CCTV Security System preferences
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Sub-nav */}
        <Card className="p-2 h-fit">
          {subnav.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => setTab(s.key)}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  tab === s.key
                    ? "bg-brand/10 text-brand"
                    : "text-muted hover:bg-app hover:text-main"
                )}
              >
                <Icon className="w-[18px] h-[18px]" />
                {s.label}
              </button>
            );
          })}
        </Card>

        {/* Panels */}
        {tab === "profile" && (
          <Card className="p-6">
            <h2 className="font-semibold mb-5">Profile Settings</h2>
            <div className="flex items-center gap-4 mb-6">
              <div className="grid place-items-center w-16 h-16 rounded-full bg-gradient-to-br from-brand to-brand-light text-white text-xl font-semibold">
                {avatarInitial}
              </div>
              <div>
                <div className="font-semibold">{profile.fullName || "—"}</div>
                <div className="text-xs text-muted">{profile.role || "—"}</div>
                <button className="mt-2 text-xs font-medium text-brand hover:text-brand-light">
                  Change Photo
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <Field label="Full Name" value={profile.fullName} onChange={(v) => setProfile({ ...profile, fullName: v })} />
              <Field label="Email" value={profile.email} readOnly />
              <Field label="Role" value={profile.role} readOnly />
              <Field label="Phone" value={profile.phone} onChange={(v) => setProfile({ ...profile, phone: v })} placeholder="Add a phone number" />
            </div>
            <button className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity">
              <Check className="w-4 h-4" /> Save Profile
            </button>
          </Card>
        )}

        {tab === "appearance" && (
          <Card className="p-6">
            <h2 className="font-semibold mb-5">Appearance</h2>
            <div className="mb-6">
              <div className="text-sm font-medium mb-2">Theme</div>
              <div className="flex gap-3">
                <button
                  onClick={() => setTheme("light")}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                    theme === "light" ? "border-brand bg-brand/10 text-brand" : "border-app text-muted hover:text-main"
                  )}
                >
                  <Sun className="w-4 h-4" /> Light
                </button>
                <button
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                    theme === "dark" ? "border-brand bg-brand/10 text-brand" : "border-app text-muted hover:text-main"
                  )}
                >
                  <Moon className="w-4 h-4" /> Dark
                </button>
              </div>
            </div>
          </Card>
        )}

        {tab === "notifications" && (
          <Card className="p-6">
            <h2 className="font-semibold mb-5">Notifications</h2>
            <div className="divide-y divide-[var(--border)] max-w-2xl">
              {[
                ["Email alerts", "Receive an email for every critical alert", true],
                ["Push notifications", "Browser push for live detections", true],
                ["Intrusion alerts", "Notify immediately on intrusion events", true],
                ["Weekly summary", "A digest of activity every Monday", false],
                ["Camera offline alerts", "Notify when a camera goes offline", true],
              ].map(([title, desc, on]) => (
                <div key={title as string} className="flex items-center justify-between py-4">
                  <div>
                    <div className="text-sm font-medium">{title}</div>
                    <div className="text-xs text-muted">{desc}</div>
                  </div>
                  <Toggle defaultOn={on as boolean} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab === "security" && (
          <div className="space-y-4">
            {/* Current password card (with reveal) */}
            <Card className="p-6 max-w-2xl">
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="w-4 h-4 text-brand" />
                <h2 className="font-semibold">Password</h2>
              </div>
              <p className="text-xs text-muted mb-4">Your current account password.</p>

              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    readOnly
                    type={revealCurrent ? "text" : "password"}
                    value={auth.password ?? ""}
                    placeholder="••••••"
                    className="w-full rounded-lg border border-app bg-app px-3 py-2.5 pr-10 text-sm font-mono tracking-wider outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setRevealCurrent((v) => !v)}
                    aria-label={revealCurrent ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-muted hover:text-main hover:bg-card transition-colors"
                  >
                    {revealCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {!auth.password && (
                <p className="mt-2 text-xs text-muted">
                  Password isn’t available to display — sign in again to load it.
                </p>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
