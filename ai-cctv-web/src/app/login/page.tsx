"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2 } from "lucide-react";
import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      try {
        // Keep the password client-side so the Security card can reveal it.
        localStorage.setItem("auth", JSON.stringify({ ...res, password }));
      } catch {
        /* ignore */
      }
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-app p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="grid place-items-center w-14 h-14 rounded-2xl bg-gradient-to-br from-brand to-brand-light shadow-lg shadow-brand/20 mb-3">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold">AI CCTV</h1>
          <p className="text-sm text-muted">Security Monitoring System</p>
        </div>

        <form onSubmit={submit} className="bg-card border border-app rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-lg">Sign in</h2>

          {error && (
            <div className="rounded-lg bg-red-500/10 text-red-500 text-sm px-3 py-2">{error}</div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-muted">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@cctv.com"
              className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-muted">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <p className="text-xs text-muted text-center">
            Don’t have an account? Ask an admin to create one.
          </p>
        </form>
      </div>
    </div>
  );
}
