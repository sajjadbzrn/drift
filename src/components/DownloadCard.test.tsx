import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DownloadCard } from "./DownloadCard";
import { I18nProvider } from "../lib/i18n";
import type { DownloadInfo } from "../types";

afterEach(() => {
  cleanup();
});

const noop = () => {};

function makeDownload(overrides: Partial<DownloadInfo> = {}): DownloadInfo {
  return {
    id: "test-1",
    url: "https://example.com/file.zip",
    referrer: null,
    cookies: null,
    filename: "file.zip",
    dir: "/downloads",
    path: "/downloads/file.zip",
    totalSize: 1024 * 1024,
    received: 512 * 1024,
    status: "downloading",
    speed: 1024 * 100,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    segments: [{ index: 0, start: 0, end: 1024 * 1024, received: 512 * 1024 }],
    segmented: false,
    supportsRanges: true,
    retries: 0,
    speedLimit: 0,
    hash: null,
    verified: false,
    proxy: null,
    completedAt: null,
    priority: 0,
    etag: null,
    lastModified: null,
    ...overrides,
  };
}

function renderCard(d: DownloadInfo, props = {}) {
  return render(
    <I18nProvider lang="en">
      <DownloadCard
        d={d}
        onContext={noop}
        onPause={noop}
        onResume={noop}
        onRetry={noop}
        onCancel={noop}
        onRemove={noop}
        onOpenFile={noop}
        onOpenFolder={noop}
        onCopy={noop}
        onOpenDetails={noop}
        {...props}
      />
    </I18nProvider>,
  );
}

describe("DownloadCard", () => {
  test("renders the filename", () => {
    const d = makeDownload({ filename: "vacation.mp4" });
    renderCard(d);
    expect(screen.getByText("vacation.mp4")).toBeInTheDocument();
  });

  test("renders status badge for downloading state", () => {
    const d = makeDownload({ status: "downloading" });
    renderCard(d);
    expect(screen.getByText("Downloading")).toBeInTheDocument();
  });

  test("renders status badge for completed state", () => {
    const d = makeDownload({
      status: "completed",
      received: 1024 * 1024,
      totalSize: 1024 * 1024,
      completedAt: Date.now(),
    });
    renderCard(d);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  test("renders status badge for paused state", () => {
    const d = makeDownload({ status: "paused" });
    renderCard(d);
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  test("renders status badge for failed state", () => {
    const d = makeDownload({ status: "failed", error: "Connection refused" });
    renderCard(d);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  test("renders error message for failed downloads", () => {
    const d = makeDownload({ status: "failed", error: "Server returned 404" });
    renderCard(d);
    expect(screen.getByText("Server returned 404")).toBeInTheDocument();
  });

  test("shows progress bar with correct fill", () => {
    const d = makeDownload({
      totalSize: 2000,
      received: 1000,
      status: "downloading",
    });
    const { container } = renderCard(d);
    const fill = container.querySelector(".card-bar-fill");
    expect(fill).toBeTruthy();
    expect(fill).toHaveStyle({ width: "50%" });
  });

  test("applies card-selected class when selected", () => {
    const d = makeDownload();
    const { container } = renderCard(d, { selected: true });
    const card = container.querySelector(".card");
    expect(card).toHaveClass("card-selected");
  });

  test("applies card-compact class in compact mode", () => {
    const d = makeDownload();
    const { container } = renderCard(d, { compact: true });
    const card = container.querySelector(".card");
    expect(card).toHaveClass("card-compact");
  });

  test("shows segmented badge when segmented", () => {
    const d = makeDownload({
      segmented: true,
      segments: [
        { index: 0, start: 0, end: 500, received: 500 },
        { index: 1, start: 500, end: 1000, received: 300 },
      ],
    });
    renderCard(d);
    // Should show the segment count badge
    expect(screen.getByText("2×")).toBeInTheDocument();
  });

  test("renders file kind icon title", () => {
    const d = makeDownload({ filename: "song.mp3" });
    renderCard(d);
    // The icon container should have a title with the file kind
    expect(screen.getByTitle("audio")).toBeInTheDocument();
  });

  test("renders action buttons for downloading state", () => {
    const d = makeDownload({ status: "downloading" });
    renderCard(d);
    expect(screen.getByTitle("Pause")).toBeInTheDocument();
    expect(screen.getByTitle("Cancel")).toBeInTheDocument();
    expect(screen.getByTitle("Copy link")).toBeInTheDocument();
  });

  test("renders action buttons for paused state", () => {
    const d = makeDownload({ status: "paused" });
    renderCard(d);
    expect(screen.getByTitle("Resume")).toBeInTheDocument();
    expect(screen.getByTitle("Copy link")).toBeInTheDocument();
  });

  test("renders action buttons for completed state", () => {
    const d = makeDownload({
      status: "completed",
      completedAt: Date.now(),
    });
    renderCard(d);
    expect(screen.getByTitle("Open file")).toBeInTheDocument();
    expect(screen.getByTitle("Copy link")).toBeInTheDocument();
  });
});
