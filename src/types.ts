export type DownloadStatus =
  | "queued"
  | "downloading"
  | "retrying"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface SegmentInfo {
  index: number;
  start: number;
  end: number;
  received: number;
}

export interface DownloadInfo {
  id: string;
  url: string;
  filename: string;
  dir: string;
  path: string;
  totalSize: number | null;
  received: number;
  status: DownloadStatus;
  speed: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  segments: SegmentInfo[];
  segmented: boolean;
  supportsRanges: boolean;
  retries: number;
  speedLimit: number;
  completedAt: number | null;
}

export type Theme = "system" | "dark" | "light";

export interface AppSettings {
  theme: Theme;
  /** bytes/second, 0 = unlimited */
  globalSpeedLimit: number;
  /** default per-download limit, 0 = unlimited */
  defaultSpeedLimit: number;
  maxConcurrent: number;
  segmented: boolean;
  autoRetry: boolean;
  maxRetries: number;
  deleteWithRemove: boolean;
  lastSaveDir: string | null;
}

export interface UrlMeta {
  filename: string;
  size: number | null;
  supportsRanges: boolean;
  contentType: string | null;
}

export type Filter =
  | "all"
  | "active"
  | "completed"
  | "paused"
  | "failed";

export interface Toast {
  id: number;
  msg: string;
  kind: "success" | "error" | "info";
}
