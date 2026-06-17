"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as signalR from "@microsoft/signalr";
import {
  API_BASE,
  getAlerts,
  closeAlert,
  deleteAlert,
  mapAlert,
  type ApiAlert,
  type DisplayAlert,
} from "@/lib/api";

export type LiveAlert = DisplayAlert;
export type ConnState = "live" | "offline" | "connecting";

export function useAlerts() {
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [conn, setConn] = useState<ConnState>("connecting");
  const hubRef = useRef<signalR.HubConnection | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data: ApiAlert[] = await getAlerts();
      setAlerts(data.map(mapAlert));
      setConn("live");
    } catch {
      setAlerts([]);
      setConn("offline");
    }
  }, []);

  useEffect(() => {
    refresh();

    const hub = new signalR.HubConnectionBuilder()
      .withUrl(`${API_BASE}/alerthub`)
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.None)
      .build();
    hubRef.current = hub;

    const onAny = () => refresh();
    hub.on("NewAlert", onAny);
    hub.on("AlertUpdated", onAny);
    hub.on("AlertDeleted", onAny);
    hub.on("AlertsCleared", onAny);

    hub.start().catch(() => {
      /* SignalR optional — REST refresh already covers data */
    });

    return () => {
      hub.stop();
    };
  }, [refresh]);

  const resolve = useCallback(
    async (id: string) => {
      setAlerts((list) =>
        list.map((a) => (a.id === id ? { ...a, status: "Resolved" } : a))
      );
      try {
        await closeAlert(id);
        refresh();
      } catch {
        /* keep optimistic state */
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      setAlerts((list) => list.filter((a) => a.id !== id));
      try {
        await deleteAlert(id);
        refresh();
      } catch {
        /* keep optimistic state */
      }
    },
    [refresh]
  );

  return { alerts, conn, resolve, remove, refresh };
}
