"use client";

import { useEffect, useState } from "react";
import { Maximize2, Grid2x2, Grid3x3, Video, MapPin, WifiOff } from "lucide-react";
import { Card, FilterTabs } from "@/components/ui";
import { getCameras, type ApiCamera } from "@/lib/api";
import { useFetch } from "@/lib/use-fetch";
import { cn } from "@/lib/utils";

type Tab = "all" | "online" | "offline";

function CameraFeed({ cam }: { cam: ApiCamera }) {
  const [broken, setBroken] = useState(false);
  const offline = cam.status !== "online" || broken;

  return (
    <div className="relative aspect-video bg-black overflow-hidden">
      {cam.status === "online" && cam.streamUrl && !broken ? (
        // MJPEG live feed from the camera's stream URL (Python Flask /video).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cam.streamUrl}
          alt={cam.name}
          className="w-full h-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div className="text-muted">
            <WifiOff className="w-8 h-8 mx-auto mb-1 opacity-50" />
            <div className="text-xs font-semibold text-red-400">NO SIGNAL</div>
          </div>
        </div>
      )}

      {/* Top-left badges */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5">
        {cam.ptz && (
          <span className="rounded bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5">PTZ</span>
        )}
        {cam.recording && !offline && (
          <span className="flex items-center gap-1 rounded bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> REC
          </span>
        )}
        {offline ? (
          <span className="rounded bg-red-500/80 text-white text-[10px] font-semibold px-1.5 py-0.5">OFFLINE</span>
        ) : (
          <span className="flex items-center gap-1 rounded bg-emerald-500/80 text-white text-[10px] font-semibold px-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white" /> LIVE
          </span>
        )}
      </div>

      {!offline && (
        <span className="absolute bottom-2 right-2 rounded bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5">
          {cam.fps} FPS · {cam.resolution}
        </span>
      )}
    </div>
  );
}

export default function LiveCamerasPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [cols, setCols] = useState<2 | 3>(3);
  const { data: cameras, loading, error, reload } = useFetch<ApiCamera[]>(getCameras);

  // Poll so a camera going offline (detected by the backend monitor) flips the
  // status here without a manual refresh.
  useEffect(() => {
    const id = setInterval(reload, 10000);
    return () => clearInterval(id);
  }, [reload]);

  const list = cameras ?? [];
  const filtered = list.filter((c) => (tab === "all" ? true : c.status === tab));
  const online = list.filter((c) => c.status === "online").length;
  const offline = list.length - online;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Cameras</h1>
          <p className="text-muted text-sm mt-1">Live CCTV feeds</p>
        </div>
        <div className="flex items-center gap-3">
          <FilterTabs<Tab>
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "all", label: `All (${list.length})` },
              { key: "online", label: `Online (${online})` },
              { key: "offline", label: `Offline (${offline})` },
            ]}
          />
          <div className="inline-flex items-center gap-1 rounded-lg bg-app border border-app p-1">
            <button
              onClick={() => setCols(2)}
              className={cn("grid place-items-center w-8 h-8 rounded-md transition-colors", cols === 2 ? "bg-brand text-white" : "text-muted hover:text-main")}
            >
              <Grid2x2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCols(3)}
              className={cn("grid place-items-center w-8 h-8 rounded-md transition-colors", cols === 3 ? "bg-brand text-white" : "text-muted hover:text-main")}
            >
              <Grid3x3 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <Card className="p-12 grid place-items-center text-muted">
          <WifiOff className="w-8 h-8 mb-2 opacity-40" />
          Couldn’t reach the API. Is the backend running on {process.env.NEXT_PUBLIC_API_BASE ?? "localhost:5237"}?
        </Card>
      )}

      {!error && (
        <div
          className={cn(
            "grid gap-4",
            cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
          )}
        >
          {filtered.map((cam) => {
            const offlineCam = cam.status !== "online";
            return (
              <Card key={cam.cameraId} className="overflow-hidden group">
                <CameraFeed cam={cam} />
                <div className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{cam.name}</div>
                    <div className="flex items-center gap-1 text-xs text-muted truncate">
                      <MapPin className="w-3 h-3" /> {cam.location}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:bg-app hover:text-main transition-colors">
                      <Maximize2 className="w-4 h-4" />
                    </button>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                        offlineCam ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full", offlineCam ? "bg-red-500" : "bg-emerald-500")} />
                      {offlineCam ? "Offline" : "Live"}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!error && !loading && filtered.length === 0 && (
        <Card className="p-12 grid place-items-center text-muted">
          <Video className="w-8 h-8 mb-2 opacity-40" />
          No cameras in this view.
        </Card>
      )}
    </div>
  );
}
