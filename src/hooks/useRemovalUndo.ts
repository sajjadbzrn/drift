import { useCallback, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/ipc";
import type { DownloadInfo } from "../types";

/**
 * Removal with a 6s undo window (per-item) plus a batch variant used by
 * "clear finished". Extracted from App.tsx so the queue screen stays lean.
 */
export function useRemovalUndo(notify: (msg: string, kind?: "success" | "error" | "info", action?: { label: string; onClick: () => void }) => void, t: (k: string, p?: Record<string, string | number>) => string) {
  /** Downloads pending removal — show undo toast, delete after 6s. */
  const pendingRemove = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [pendingRemoveIds, setPendingRemoveIds] = useState<Set<string>>(new Set());

  const unmark = useCallback((ids: string[]) => {
    setPendingRemoveIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const scheduleRemove = useCallback(
    (d: DownloadInfo) => {
      if (pendingRemove.current.has(d.id)) return;
      const timer = setTimeout(() => {
        pendingRemove.current.delete(d.id);
        unmark([d.id]);
        void api.remove(d.id).catch(() => {});
      }, 6000);
      pendingRemove.current.set(d.id, timer);
      setPendingRemoveIds((prev) => new Set(prev).add(d.id));
      notify(t("removedToast", { name: d.filename }), "info", {
        label: t("undo"),
        onClick: () => {
          const tmr = pendingRemove.current.get(d.id);
          if (tmr) {
            clearTimeout(tmr);
            pendingRemove.current.delete(d.id);
            unmark([d.id]);
          }
        },
      });
    },
    [notify, t, unmark],
  );

  const clearFinished = useCallback(
    (downloads: DownloadInfo[], deleteWithRemove: boolean) => {
      const finished = downloads.filter((d) => d.status === "completed");
      if (finished.length === 0) return;
      const n = finished.length;
      void (async () => {
        try {
          const ok = await confirm(
            deleteWithRemove
              ? t("clearFinishedDeleteConfirm", { n })
              : t("clearFinishedListConfirm", { n }),
            { title: t("clearFinishedTitle"), kind: "warning" },
          );
          if (!ok) return;
        } catch {
          // dialog unavailable — proceed
        }
        const ids = finished.map((d) => d.id);
        for (const d of finished) {
          if (pendingRemove.current.has(d.id)) continue;
          const timer = setTimeout(() => {
            pendingRemove.current.delete(d.id);
            void api.remove(d.id).catch(() => {});
          }, 8000);
          pendingRemove.current.set(d.id, timer);
        }
        setPendingRemoveIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return next;
        });
        notify(t("clearedToast", { n }), "info", {
          label: t("undo"),
          onClick: () => {
            for (const d of finished) {
              const tmr = pendingRemove.current.get(d.id);
              if (tmr) {
                clearTimeout(tmr);
                pendingRemove.current.delete(d.id);
              }
            }
            unmark(ids);
          },
        });
      })();
    },
    [notify, t, unmark],
  );

  const isPending = useCallback((id: string) => pendingRemoveIds.has(id), [pendingRemoveIds]);

  return { scheduleRemove, clearFinished, pendingRemoveIds, isPending };
}
