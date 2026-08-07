import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  DownloadInfo,
  NativeHostStatus,
  UrlMeta,
} from "../types";

export const api = {
  probeUrl: (url: string, referrer?: string) =>
    invoke<UrlMeta>("probe_url", { url, referrer }),
  startDownload: (
    url: string,
    path: string,
    speedLimit: number | null,
    segmented: boolean | null,
    referrer?: string | null,
  ) =>
    invoke<DownloadInfo>("start_download", {
      url,
      path,
      speedLimit,
      segmented,
      referrer: referrer ?? null,
    }),
  pause: (id: string) => invoke<void>("pause_download", { id }),
  resume: (id: string) => invoke<void>("resume_download", { id }),
  retry: (id: string) => invoke<void>("retry_download", { id }),
  cancel: (id: string) => invoke<void>("cancel_download", { id }),
  remove: (id: string) => invoke<void>("remove_download", { id }),
  pauseAll: () => invoke<number>("pause_all_downloads"),
  resumeAll: () => invoke<number>("resume_all_downloads"),
  reorder: (id: string, toIndex: number) =>
    invoke<void>("reorder_download", { id, toIndex }),
  getDownloads: () => invoke<DownloadInfo[]>("get_downloads"),
  getSettings: () => invoke<AppSettings>("get_settings"),
  setSettings: (settings: AppSettings) => invoke<void>("set_settings", { settings }),
  getNativeHostStatus: () => invoke<NativeHostStatus>("get_native_host_status"),
};

export const EVENTS = {
  list: "download://list",
  progress: "download://progress",
} as const;
