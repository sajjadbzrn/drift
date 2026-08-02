import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, DownloadInfo, UrlMeta } from "../types";

export const api = {
  probeUrl: (url: string) => invoke<UrlMeta>("probe_url", { url }),
  startDownload: (
    url: string,
    path: string,
    speedLimit: number | null,
    segmented: boolean | null,
  ) => invoke<DownloadInfo>("start_download", { url, path, speedLimit, segmented }),
  pause: (id: string) => invoke<void>("pause_download", { id }),
  resume: (id: string) => invoke<void>("resume_download", { id }),
  retry: (id: string) => invoke<void>("retry_download", { id }),
  cancel: (id: string) => invoke<void>("cancel_download", { id }),
  remove: (id: string) => invoke<void>("remove_download", { id }),
  getDownloads: () => invoke<DownloadInfo[]>("get_downloads"),
  getSettings: () => invoke<AppSettings>("get_settings"),
  setSettings: (settings: AppSettings) => invoke<void>("set_settings", { settings }),
};

export const EVENTS = {
  list: "download://list",
  progress: "download://progress",
} as const;
