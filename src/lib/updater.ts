import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

/**
 * Check for an available update. Returns null when the app is up to date.
 * Throws when the updater is unavailable (dev mode, wrong config, network).
 */
export async function checkForUpdate(): Promise<Update | null> {
  return check();
}

export function infoOf(u: Update): UpdateInfo {
  return { version: u.version, body: u.body ?? null };
}

export async function downloadAndInstallUpdate(
  u: Update,
  onProgress: (received: number, total: number | null) => void,
): Promise<void> {
  let total: number | null = null;
  let received = 0;
  await u.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      onProgress(0, total);
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      onProgress(received, total);
    } else if (event.event === "Finished") {
      onProgress(received, total);
    }
  });
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}
