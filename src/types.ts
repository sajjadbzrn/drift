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
  /** Referer header sent with the requests (from the browser extension handoff). */
  referrer: string | null;
  /** Cookie header value sent with the requests (extension forwards cookies
   *  for login-protected downloads). */
  cookies: string | null;
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
  /** Queue position: lower = closer to the front (0 = first). */
  priority: number;
}

export type Theme = "system" | "dark" | "light";

export type Lang = "en" | "fa";

export interface AppSettings {
  theme: Theme;
  /** UI language: "en" | "fa". */
  language: Lang;
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
  /** Skip the save dialog and write straight into the chosen folder. */
  autoSave: boolean;
  /** Closing the window hides to tray; downloads keep running. */
  closeToTray: boolean;
  /** Chrome extension IDs allowed to talk to drift's native messaging host. */
  chromeExtIds: string[];
  /** Custom User-Agent sent with download/probe requests (empty = default). */
  userAgent: string;
}

export interface NativeHostStatus {
  registered: boolean;
  manifestPath: string | null;
  hostPath: string | null;
  allowedOrigins: string[];
  allowedExtensions: string[];
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

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  msg: string;
  kind: "success" | "error" | "info";
  action?: ToastAction;
}
