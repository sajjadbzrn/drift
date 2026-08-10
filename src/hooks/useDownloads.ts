import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, EVENTS } from "../lib/ipc";
import type { DownloadInfo } from "../types";

export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadInfo[]>([]);

  useEffect(() => {
    let disposed = false;
    let unlist: (() => void) | null = null;
    let unprog: (() => void) | null = null;

    (async () => {
      const [l, p] = await Promise.all([
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
      ]);
      if (disposed) {
        l();
        p();
        return;
      }
      unlist = l;
      unprog = p;
      try {
        const initial = await api.getDownloads();
        if (!disposed) setDownloads(initial);
      } catch {
        // backend unavailable (e.g. running in a plain browser) — stay empty
      }
    })();

    return () => {
      disposed = true;
      unlist?.();
      unprog?.();
    };
  }, []);

  return downloads;
}
