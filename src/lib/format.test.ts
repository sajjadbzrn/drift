import { describe, test, expect, beforeEach } from "bun:test";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  extOf,
  fileKindOf,
  looksLikeUrl,
  isActive,
  KIND_COLOR,
} from "./format";
import { setActiveLang } from "./i18n";

beforeEach(() => {
  setActiveLang("en");
});

// ─── formatBytes ────────────────────────────────────────────────

describe("formatBytes", () => {
  test("returns — for non-finite or negative values", () => {
    expect(formatBytes(NaN)).toBe("—");
    expect(formatBytes(Infinity)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });

  test("formats bytes under 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  test("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(10 * 1024)).toBe("10.0 KB");
    expect(formatBytes(100 * 1024)).toBe("100 KB");
  });

  test("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB");
  });

  test("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
  });

  test("formats terabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1.00 TB");
  });

  test("uses correct digit precision based on magnitude", () => {
    // ≥100 → 0 decimal places
    expect(formatBytes(100 * 1024)).toBe("100 KB");
    // 10..99 → 1 decimal place
    expect(formatBytes(50.5 * 1024)).toBe("50.5 KB");
    // <10 → 2 decimal places
    expect(formatBytes(5.25 * 1024)).toBe("5.25 KB");
  });
});

// ─── formatSpeed ────────────────────────────────────────────────

describe("formatSpeed", () => {
  test("returns — for zero or negative", () => {
    expect(formatSpeed(0)).toBe("—");
    expect(formatSpeed(-5)).toBe("—");
    expect(formatSpeed(NaN)).toBe("—");
  });

  test("formats positive speeds with /s suffix", () => {
    expect(formatSpeed(1024)).toBe("1.00 KB/s");
    expect(formatSpeed(100 * 1024)).toBe("100 KB/s");
  });
});

// ─── formatEta ──────────────────────────────────────────────────

describe("formatEta", () => {
  test("returns — for invalid inputs", () => {
    expect(formatEta(0, 1024)).toBe("—");
    expect(formatEta(1024, 0)).toBe("—");
    expect(formatEta(-1, 1024)).toBe("—");
    expect(formatEta(NaN, 1024)).toBe("—");
  });

  test("formats seconds", () => {
    expect(formatEta(5 * 1024, 1024)).toBe("5 s");
  });

  test("formats minutes and seconds", () => {
    // 125 seconds at 1024 B/s = 125 s → 2 m 05 s
    expect(formatEta(125 * 1024, 1024)).toBe("2 m 05 s");
  });

  test("formats hours and minutes", () => {
    // 3665 seconds at 1024 B/s → 1 h 01 m
    expect(formatEta(3665 * 1024, 1024)).toBe("1 h 01 m");
  });
});

// ─── extOf ──────────────────────────────────────────────────────

describe("extOf", () => {
  test("extracts file extensions", () => {
    expect(extOf("photo.jpg")).toBe("jpg");
    expect(extOf("archive.tar.gz")).toBe("gz");
    expect(extOf("noext")).toBe("");
    expect(extOf(".hidden")).toBe("");
    expect(extOf("trailing.")).toBe("");
    expect(extOf("UPPERCASE.PNG")).toBe("png");
  });
});

// ─── fileKindOf ─────────────────────────────────────────────────

describe("fileKindOf", () => {
  test("detects image files", () => {
    expect(fileKindOf("photo.jpg")).toBe("image");
    expect(fileKindOf("icon.svg")).toBe("image");
    expect(fileKindOf("banner.webp")).toBe("image");
  });

  test("detects video files", () => {
    expect(fileKindOf("movie.mp4")).toBe("video");
    expect(fileKindOf("clip.mkv")).toBe("video");
  });

  test("detects audio files", () => {
    expect(fileKindOf("song.mp3")).toBe("audio");
    expect(fileKindOf("podcast.flac")).toBe("audio");
  });

  test("detects archive files", () => {
    expect(fileKindOf("backup.zip")).toBe("archive");
    expect(fileKindOf("data.7z")).toBe("archive");
  });

  test("detects code files", () => {
    expect(fileKindOf("index.ts")).toBe("code");
    expect(fileKindOf("main.rs")).toBe("code");
    expect(fileKindOf("app.py")).toBe("code");
  });

  test("detects pdf files", () => {
    expect(fileKindOf("report.pdf")).toBe("pdf");
  });

  test("detects app files", () => {
    expect(fileKindOf("setup.exe")).toBe("app");
    expect(fileKindOf("app.apk")).toBe("app");
  });

  test("returns 'file' for unknown extensions", () => {
    expect(fileKindOf("mystery.xyz")).toBe("file");
    expect(fileKindOf("noext")).toBe("file");
  });
});

// ─── looksLikeUrl ───────────────────────────────────────────────

describe("looksLikeUrl", () => {
  test("accepts valid http/https URLs", () => {
    expect(looksLikeUrl("https://example.com/file.zip")).toBe(true);
    expect(looksLikeUrl("http://cdn.server.com/img.png")).toBe(true);
    expect(looksLikeUrl("www.example.com/page")).toBe(true);
  });

  test("rejects non-URLs", () => {
    expect(looksLikeUrl("just some text")).toBe(false);
    expect(looksLikeUrl("ftp://server.com/file")).toBe(false);
    expect(looksLikeUrl("")).toBe(false);
    expect(looksLikeUrl("  ")).toBe(false);
  });

  test("rejects URLs with spaces", () => {
    expect(looksLikeUrl("https://example.com/has space")).toBe(false);
  });
});

// ─── isActive ───────────────────────────────────────────────────

describe("isActive", () => {
  test("returns true for active statuses", () => {
    expect(isActive("queued")).toBe(true);
    expect(isActive("downloading")).toBe(true);
    expect(isActive("retrying")).toBe(true);
  });

  test("returns false for inactive statuses", () => {
    expect(isActive("paused")).toBe(false);
    expect(isActive("completed")).toBe(false);
    expect(isActive("failed")).toBe(false);
    expect(isActive("cancelled")).toBe(false);
  });
});

// ─── KIND_COLOR ─────────────────────────────────────────────────

describe("KIND_COLOR", () => {
  test("has a color for every file kind", () => {
    const kinds = [
      "image", "video", "audio", "archive", "code",
      "doc", "pdf", "app", "sheet", "slides", "file",
    ] as const;
    for (const kind of kinds) {
      expect(KIND_COLOR[kind]).toBeTruthy();
      expect(KIND_COLOR[kind]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
