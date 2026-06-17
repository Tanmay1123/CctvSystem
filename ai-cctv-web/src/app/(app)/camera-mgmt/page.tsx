"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import {
  getCameras,
  createCamera,
  updateCamera,
  deleteCamera,
  type ApiCamera,
} from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";

type Draft = Partial<ApiCamera>;

const blank: Draft = {
  name: "",
  location: "",
  ipAddress: "",
  streamUrl: "",
  status: "online",
  resolution: "1920x1080",
  fps: 25,
  ptz: false,
  recording: true,
  uptime: 100,
};

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
      />
    </label>
  );
}

export default function CameraMgmtPage() {
  const { data, loading, error, reload } = useFetch<ApiCamera[]>(getCameras);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [saving, setSaving] = useState(false);

  const cameras = data ?? [];

  const startAdd = () => {
    setDraft(blank);
    setOpen(true);
  };
  const startEdit = (c: ApiCamera) => {
    setDraft(c);
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (draft.cameraId) await updateCamera(draft.cameraId, draft);
      else await createCamera(draft);
      setOpen(false);
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: ApiCamera) => {
    if (!confirm(`Delete ${c.name}?`)) return;
    await deleteCamera(c.cameraId);
    reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Camera Management</h1>
          <p className="text-muted text-sm mt-1">Configure and monitor all cameras</p>
        </div>
        <button
          onClick={startAdd}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" /> Add Camera
        </button>
      </div>

      {error && (
        <Card className="p-10 text-center text-muted">Couldn’t reach the API. Is the backend running?</Card>
      )}

      {!error && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-app">
                  <th className="font-medium px-4 py-3">Name</th>
                  <th className="font-medium px-4 py-3">Location</th>
                  <th className="font-medium px-4 py-3">IP Address</th>
                  <th className="font-medium px-4 py-3">Status</th>
                  <th className="font-medium px-4 py-3">Resolution</th>
                  <th className="font-medium px-4 py-3">FPS</th>
                  <th className="font-medium px-4 py-3">Uptime</th>
                  <th className="font-medium px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {cameras.map((c) => (
                  <tr key={c.cameraId} className="hover:bg-app transition-colors">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-muted">{c.location}</td>
                    <td className="px-4 py-3 text-muted tabular-nums">{c.ipAddress}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-muted">{c.resolution}</td>
                    <td className="px-4 py-3 text-muted tabular-nums">{c.fps}</td>
                    <td className="px-4 py-3 text-muted tabular-nums">{c.uptime}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => startEdit(c)} className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-brand/10 hover:text-brand transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => remove(c)} className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && cameras.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted">No cameras yet. Add one to get started.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add / edit modal */}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-lg p-6" >
            <div className="flex items-center justify-between mb-5" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-semibold text-lg">{draft.cameraId ? "Edit Camera" : "Add Camera"}</h2>
              <button onClick={() => setOpen(false)} className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-app">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" onClick={(e) => e.stopPropagation()}>
              <Input label="Name" value={draft.name ?? ""} onChange={(v) => setDraft({ ...draft, name: v })} />
              <Input label="Location" value={draft.location ?? ""} onChange={(v) => setDraft({ ...draft, location: v })} />
              <Input label="IP Address" value={draft.ipAddress ?? ""} onChange={(v) => setDraft({ ...draft, ipAddress: v })} />
              <Input label="Stream URL" value={draft.streamUrl ?? ""} onChange={(v) => setDraft({ ...draft, streamUrl: v })} placeholder="http://localhost:5000/video" />
              <Input label="Resolution" value={draft.resolution ?? ""} onChange={(v) => setDraft({ ...draft, resolution: v })} />
              <Input label="FPS" value={draft.fps ?? 0} onChange={(v) => setDraft({ ...draft, fps: Number(v) || 0 })} />
              <label className="block">
                <span className="text-xs font-medium text-muted">Status</span>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as "online" | "offline" })}
                  className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  <option value="online">online</option>
                  <option value="offline">offline</option>
                </select>
              </label>
              <Input label="Uptime %" value={draft.uptime ?? 0} onChange={(v) => setDraft({ ...draft, uptime: Number(v) || 0 })} />
            </div>
            <div className="flex items-center gap-4 mt-4" onClick={(e) => e.stopPropagation()}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!draft.ptz} onChange={(e) => setDraft({ ...draft, ptz: e.target.checked })} /> PTZ
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!draft.recording} onChange={(e) => setDraft({ ...draft, recording: e.target.checked })} /> Recording
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setOpen(false)} className="rounded-lg border border-app px-4 py-2 text-sm font-medium text-muted hover:bg-app">Cancel</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
