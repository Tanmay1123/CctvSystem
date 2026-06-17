"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, FilterTabs, RoleBadge } from "@/components/ui";
import { getUsers, deleteUser, type ApiUser } from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";

type Tab = "all" | "Admin" | "User";

function displayName(email: string) {
  const handle = email.split("@")[0].replace(/[._-]+/g, " ");
  return handle.replace(/\b\w/g, (c) => c.toUpperCase());
}
function initials(email: string) {
  const name = displayName(email).split(" ");
  return ((name[0]?.[0] ?? "") + (name[1]?.[0] ?? "")).toUpperCase() || email[0].toUpperCase();
}

export default function UsersPage() {
  const [tab, setTab] = useState<Tab>("all");
  const { data, loading, error, reload } = useFetch<ApiUser[]>(getUsers);

  const users = data ?? [];
  const rows = users.filter((u) => (tab === "all" ? true : u.role === tab));

  const remove = async (u: ApiUser) => {
    if (!confirm(`Delete ${u.email}?`)) return;
    await deleteUser(u.userId);
    reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-muted text-sm mt-1">Accounts with access to the system</p>
        </div>
      </div>

      <FilterTabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "all", label: "All" },
          { key: "Admin", label: "Admin" },
          { key: "User", label: "User" },
        ]}
      />

      {error && <Card className="p-10 text-center text-muted">Couldn’t reach the API. Is the backend running?</Card>}

      {!error && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-app">
                  <th className="font-medium px-4 py-3">Name</th>
                  <th className="font-medium px-4 py-3">Email</th>
                  <th className="font-medium px-4 py-3">Role</th>
                  <th className="font-medium px-4 py-3">Joined</th>
                  <th className="font-medium px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((u) => (
                  <tr key={u.userId} className="hover:bg-app transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="grid place-items-center w-9 h-9 rounded-full bg-gradient-to-br from-brand to-brand-light text-white text-xs font-semibold shrink-0">
                          {initials(u.email)}
                        </div>
                        <span className="font-medium">{displayName(u.email)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{u.email}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">
                      {new Date(u.createdDate).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => remove(u)} className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-muted">No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
