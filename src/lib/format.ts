const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  let u = 0;
  let v = n;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${UNITS[u]}`;
}

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "—";
  return `${formatBytes(bps)}/s`;
}

export function formatEta(remaining: number, speed: number): string {
  if (!Number.isFinite(remaining) || remaining <= 0 || speed <= 0) return "—";
  const secs = Math.max(1, Math.round(remaining / speed));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
}

export function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i <= 0 || i === filename.length - 1) return "";
  return filename.slice(i + 1).toLowerCase();
}

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "doc"
  | "pdf"
  | "app"
  | "sheet"
  | "slides"
  | "file";

const KIND_BY_EXT: Record<string, FileKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  svg: "image", ico: "image", bmp: "image", avif: "image", heic: "image",
  mp4: "video", mkv: "video", webm: "video", mov: "video", avi: "video",
  m4v: "video", flv: "video", wmv: "video",
  mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio",
  aac: "audio", opus: "audio", wma: "audio", mid: "audio",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
  bz2: "archive", xz: "archive", iso: "archive", dmg: "archive",
  js: "code", mjs: "code", cjs: "code", ts: "code", tsx: "code", jsx: "code",
  rs: "code", py: "code", go: "code", java: "code", c: "code", cpp: "code",
  h: "code", cs: "code", rb: "code", php: "code", sh: "code", json: "code",
  yml: "code", yaml: "code", toml: "code", xml: "code", html: "code",
  css: "code", scss: "code", sql: "code", swift: "code", kt: "code",
  doc: "doc", docx: "doc", txt: "doc", md: "doc", rtf: "doc", odt: "doc",
  pdf: "pdf",
  exe: "app", msi: "app", apk: "app", deb: "app", appimage: "app", pkg: "app",
  msix: "app", appx: "app", bat: "app", cmd: "app",
  xls: "sheet", xlsx: "sheet", csv: "sheet", ods: "sheet",
  ppt: "slides", pptx: "slides", odp: "slides",
};

export function fileKindOf(filename: string): FileKind {
  const ext = extOf(filename);
  // "ts" collision: video transport stream vs TypeScript — prefer code for .ts
  if (ext === "ts") return "code";
  return KIND_BY_EXT[ext] ?? "file";
}

export const KIND_COLOR: Record<FileKind, string> = {
  image: "#a78bfa",
  video: "#f472b6",
  audio: "#fbbf24",
  archive: "#fb923c",
  code: "#22d3ee",
  doc: "#60a5fa",
  pdf: "#f87171",
  app: "#34d399",
  sheet: "#2dd4bf",
  slides: "#818cf8",
  file: "#94a3b8",
};

export function looksLikeUrl(text: string): boolean {
  return /^(https?:\/\/|www\.)[^\s]+$/i.test(text.trim());
}

export function isActive(status: string): boolean {
  return status === "queued" || status === "downloading" || status === "retrying";
}
