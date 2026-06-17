"use client";

import { useState } from "react";
import { Play, Download, Film, Image as ImageIcon, X } from "lucide-react";
import { Card } from "@/components/ui";
import { getRecordings, mediaUrl, type ApiRecording } from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";

export default function RecordingsPage() {
  const { data, loading, error } = useFetch<ApiRecording[]>(getRecordings);
  const [playing, setPlaying] = useState<ApiRecording | null>(null);

  const recordings = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recording History</h1>
          <p className="text-muted text-sm mt-1">Captured alert footage ({recordings.length} clips)</p>
        </div>
      </div>

      {error && <Card className="p-10 text-center text-muted">Couldn’t reach the API. Is the backend running?</Card>}

      {!error && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-app">
                  <th className="font-medium px-4 py-3">Camera</th>
                  <th className="font-medium px-4 py-3">Type</th>
                  <th className="font-medium px-4 py-3">Date</th>
                  <th className="font-medium px-4 py-3">Time</th>
                  <th className="font-medium px-4 py-3">Kind</th>
                  <th className="font-medium px-4 py-3">Size</th>
                  <th className="font-medium px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {recordings.map((r) => (
                  <tr key={r.id} className="hover:bg-app transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-2">
                        <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand/10 text-brand">
                          {r.kind === "video" ? <Film className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                        </span>
                        {r.camera}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{r.type}</td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">{r.date}</td>
                    <td className="px-4 py-3 text-muted tabular-nums">{r.time}</td>
                    <td className="px-4 py-3 text-muted capitalize">{r.kind}</td>
                    <td className="px-4 py-3 text-muted">{r.size}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setPlaying(r)}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 transition-opacity"
                        >
                          <Play className="w-3.5 h-3.5" /> Play
                        </button>
                        <a
                          href={mediaUrl(r.url) ?? "#"}
                          download
                          className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-app hover:text-main transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && recordings.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">No recordings captured yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Player modal */}
      {playing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setPlaying(null)}>
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2 text-white">
              <span className="text-sm font-medium">{playing.type} • {playing.date} {playing.time}</span>
              <button onClick={() => setPlaying(null)} className="grid place-items-center w-8 h-8 rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            {playing.kind === "video" ? (
              <video src={mediaUrl(playing.url) ?? ""} controls autoPlay className="w-full rounded-xl bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl(playing.url) ?? ""} alt={playing.type} className="w-full rounded-xl bg-black" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
