import { useCallback } from "react";
import { api } from "../lib/ipc";
import { isActive } from "../lib/format";
import type { DownloadInfo } from "../types";

/**
 * All queue-level actions (pause/resume/retry/cancel, batch operations,
 * drag-reorder). Extracted from App.tsx.
 */
export function useQueueActions(
  runAction: (fn: () => Promise<unknown>, okMsg: string) => Promise<void>,
) {
  const pause = useCallback((id: string) => void runAction(() => api.pause(id), ""), [runAction]);
  const resume = useCallback((id: string) => void runAction(() => api.resume(id), ""), [runAction]);
  const retry = useCallback((id: string) => void runAction(() => api.retry(id), ""), [runAction]);
  const cancel = useCallback((id: string) => void runAction(() => api.cancel(id), ""), [runAction]);
  const pauseAll = useCallback(() => void runAction(() => api.pauseAll(), ""), [runAction]);
  const resumeAll = useCallback(() => void runAction(() => api.resumeAll(), ""), [runAction]);

  const reorder = useCallback(
    (dragId: string, overId: string, sortedAll: DownloadInfo[]) => {
      if (dragId === overId) return;
      const from = sortedAll.findIndex((d) => d.id === dragId);
      const to = sortedAll.findIndex((d) => d.id === overId);
      if (from === -1 || to === -1 || from === to) return;
      // The backend inserts at `to` *after* removing the dragged item, so a
      // downward drop shifts the target by one — compensate so dropping "on"
      // a card puts the dragged item exactly in the target's slot.
      const target = from < to ? to - 1 : to;
      void runAction(() => api.reorder(dragId, target), "");
    },
    [runAction],
  );

  const reorderIndex = useCallback(
    (id: string, index: number) => void runAction(() => api.reorder(id, index), ""),
    [runAction],
  );

  const batchAction = useCallback(
    (
      kind: "pause" | "resume" | "retry" | "remove",
      downloads: DownloadInfo[],
      selectedIds: Set<string>,
      scheduleRemove: (d: DownloadInfo) => void,
    ) => {
      const targets = downloads.filter((d) => selectedIds.has(d.id));
      if (kind === "remove") {
        for (const d of targets) scheduleRemove(d);
        return;
      }
      void runAction(async () => {
        for (const d of targets) {
          if (kind === "pause" && isActive(d.status)) await api.pause(d.id);
          else if (kind === "resume" && d.status === "paused") await api.resume(d.id);
          else if (kind === "retry" && (d.status === "failed" || d.status === "cancelled"))
            await api.retry(d.id);
        }
      }, "");
    },
    [runAction],
  );

  return { pause, resume, retry, cancel, pauseAll, resumeAll, reorder, reorderIndex, batchAction };
}
