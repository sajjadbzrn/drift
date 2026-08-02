import { useCallback, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  infoOf,
  relaunchApp,
  type UpdateInfo,
} from "../lib/updater";

export type UpdaterPhase =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "up-to-date" }
  | { phase: "available"; info: UpdateInfo }
  | { phase: "downloading"; received: number; total: number | null }
  | { phase: "installing" }
  | { phase: "error"; message: string };

export interface Updater {
  state: UpdaterPhase;
  /** Check for updates. Returns the update info when one is available, else null. */
  check: () => Promise<UpdateInfo | null>;
  /** Start downloading + installing the available update, then relaunch. */
  startUpdate: () => Promise<void>;
}

export function useUpdater(): Updater {
  const [state, setState] = useState<UpdaterPhase>({ phase: "idle" });
  const updateRef = useRef<Update | null>(null);

  const check = useCallback(async (): Promise<UpdateInfo | null> => {
    setState({ phase: "checking" });
    try {
      const u = await checkForUpdate();
      if (!u) {
        updateRef.current = null;
        setState({ phase: "up-to-date" });
        return null;
      }
      updateRef.current = u;
      const info = infoOf(u);
      setState({ phase: "available", info });
      return info;
    } catch (e) {
      updateRef.current = null;
      setState({ phase: "error", message: String(e) });
      return null;
    }
  }, []);

  const startUpdate = useCallback(async () => {
    const u = updateRef.current;
    if (!u) return;
    setState({ phase: "downloading", received: 0, total: null });
    try {
      await downloadAndInstallUpdate(u, (received, total) => {
        setState({ phase: "downloading", received, total });
      });
      setState({ phase: "installing" });
      await relaunchApp();
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  }, []);

  return { state, check, startUpdate };
}
