"use client";

import { useEffect, useState } from "react";

export interface Auth {
  email: string;
  role: string;
  token: string;
  name?: string;
  // Kept client-side only so the Settings → Security card can reveal it. The
  // backend never returns a password (it stores a one-way hash).
  password?: string;
}

// The default account shown when no one has explicitly logged in — the seeded
// admin (abhimorework@gmail.com / 123456).
export const DEFAULT_AUTH: Auth = {
  email: "abhimorework@gmail.com",
  role: "Admin",
  token: "",
  name: "Admin User",
  password: "123456",
};

// Persist the current password locally (after login or a successful change) so
// the Security card can display it.
export function setStoredPassword(password: string) {
  try {
    const current = getStoredAuth() ?? DEFAULT_AUTH;
    localStorage.setItem("auth", JSON.stringify({ ...current, password }));
  } catch {
    /* ignore */
  }
}

export function getStoredAuth(): Auth | null {
  try {
    const raw = localStorage.getItem("auth");
    return raw ? (JSON.parse(raw) as Auth) : null;
  } catch {
    return null;
  }
}

// Always returns an account: the logged-in user if present, otherwise the
// default admin.
export function useAuth(): Auth {
  const [auth, setAuth] = useState<Auth>(DEFAULT_AUTH);
  useEffect(() => {
    const stored = getStoredAuth();
    if (stored) setAuth(stored);
  }, []);
  return auth;
}

export function displayName(email: string): string {
  if (!email) return "User";
  const handle = email.split("@")[0].replace(/[._-]+/g, " ");
  return handle.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(email: string): string {
  if (!email) return "U";
  const parts = displayName(email).split(" ");
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || email[0].toUpperCase();
}

// Display name / avatar letter for an account (prefers an explicit name).
export function userName(a: Auth): string {
  return a.name ?? displayName(a.email);
}

export function userInitial(a: Auth): string {
  return (userName(a).trim()[0] ?? "U").toUpperCase();
}
