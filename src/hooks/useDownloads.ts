import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, EVENTS } from "../lib/ipc";
import type { DownloadInfo } from "../types";

/**
 * How long progress events are coalesced before they reach React state (ms).
 * The backend emits roughly every 150 ms per active download, so without this
 * a burst of concurrent downloads would drive a React render per download per
 * tick. Batching caps re-renders by *time* instead of by download count.
 */
const PROGRESS_FLUSH_MS = 140;

/** Queue order — must match the backend's sort and App's rendering exactly. */
function sortQueue(list: DownloadInfo[]): DownloadInfo[] {
  return list.sort((a, b) => a.priority - b.priority || b.createdAt - a.createdAt);
}

export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadInfo[]>([]);

  useEffect(() => {
    let disposed = false;
    let unlist: (() => void) | null = null;
    let unprog: (() => void) | null = null;
    let flushTimer: number | null = null;
    let pending = new Map<string, DownloadInfo>();

    // Apply the coalesced batch in one state update. Entries that didn't emit
    // keep their previous object identity, so memoized cards skip re-rendering.
    const flush = () => {
      flushTimer = null;
      if (pending.size === 0) return;
      const batch = pending;
      pending = new Map();
      setDownloads((prev) => {
        let next: DownloadInfo[] | null = null;
        let added = false;
        for (const [id, info] of batch) {
          if (next === null) next = prev.slice();
          const idx = next.findIndex((d) => d.id === id);
          if (idx === -1) {
            next.push(info);
            added = true;
          } else {
            next[idx] = info;
          }
        }
        if (next === null) return prev;
        // Only pay for a sort when the queue actually gained an entry.
        return added ? sortQueue(next) : next;
      });
    };

    const schedule = () => {
      if (flushTimer !== null) return;
      flushTimer = window.setTimeout(flush, PROGRESS_FLUSH_MS);
    };

    (async () => {
      const [l, p] = await Promise.all([
        listen<DownloadInfo[]>(EVENTS.list, (e) => {
          if (disposed) return;
          // The list snapshot is authoritative (removals, reorders, status
          // transitions) — drop pending progress so a removed id can't be
          // resurrected by a late-arriving tick.
          pending.clear();
          setDownloads(sortQueue([...e.payload]));
        }),
        listen<DownloadInfo>(EVENTS.progress, (e) => {
          if (disposed) return;
          pending.set(e.payload.id, e.payload);
          schedule();
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
        if (!disposed) setDownloads(sortQueue([...initial]));
      } catch {
        // backend unavailable (e.g. running in a plain browser) — stay empty
      }
    })();

    return () => {
      disposed = true;
      unlist?.();
      unprog?.();
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      pending.clear();
    };
  }, []);

  return downloads;
}
