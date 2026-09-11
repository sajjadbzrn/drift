import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, EVENTS } from "../lib/ipc";
import type { DownloadInfo } from "../types";

export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadInfo[]>([]);

  useEffect(() => {
    let disposed = false;
    const unsubs: (() => void)[] = [];

    (async () => {
      const [l, p, b] = await Promise.all([
        listen<DownloadInfo[]>(EVENTS.list, (e) => {
          if (!disposed) setDownloads(e.payload);
        }),
        listen<DownloadInfo>(EVENTS.progress, (e) => {
          if (disposed) return;
          const next = e.payload;
          setDownloads((prev) => {
            const idx = prev.findIndex((d) => d.id === next.id);
            if (idx === -1) {
              // New download — insert sorted by (priority, -createdAt).
              const list = [...prev, next];
              list.sort((a, b) => a.priority - b.priority || b.createdAt - a.createdAt);
              return list;
            }
            // Progress deltas only update bytes/speed/status — never the queue
            // order (priority). Skipping the sort here keeps the per-tick cost
            // at O(n) instead of O(n log n) for every active download.
            const updated = [...prev];
            updated[idx] = next;
            return updated;
          });
        }),
        // Batched progress from the backend pump: one event every 200ms
        // carrying every download whose bytes/status changed. This replaces
        // the old per-worker event storm (~7 IPC round-trips/s per download).
        listen<DownloadInfo[]>(EVENTS.progressBatch, (e) => {
          if (disposed) return;
          const batch = e.payload;
          if (!batch.length) return;
          setDownloads((prev) => {
            let list = prev;
            for (const next of batch) {
              const idx = list.findIndex((d) => d.id === next.id);
              if (idx === -1) {
                list = [...list, next];
                list.sort((a, b) => a.priority - b.priority || b.createdAt - a.createdAt);
                continue;
              }
              list = list.slice();
              list[idx] = next;
            }
            return list === prev ? prev : list;
          });
        }),
      ]);
      if (disposed) {
        l();
        p();
        b();
        return;
      }
      unsubs.push(l, p, b);
      try {
        const initial = await api.getDownloads();
        if (!disposed) setDownloads(initial);
      } catch {
        // backend unavailable (e.g. running in a plain browser) — stay empty
      }
    })();

    return () => {
      disposed = true;
      for (const u of unsubs) u();
    };
  }, []);

  return downloads;
}
