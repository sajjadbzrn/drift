import { useEffect, useRef, type ReactNode } from "react";
import type { DownloadInfo } from "../types";
import {
  fileKindOf,
  KIND_COLOR,
  formatBytes,
  formatSpeed,
  formatEta,
  formatDate,
} from "../lib/format";
import {
  AppIcon,
  ArchiveIcon,
  CodeIcon,
  ExternalIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  LinkIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  TrashIcon,
  VideoIcon,
  XIcon,
  BoltIcon,
} from "../lib/icons";

function KindIcon({ kind }: { kind: ReturnType<typeof fileKindOf> }) {
  switch (kind) {
    case "image":
      return <ImageIcon width={20} height={20} />;
    case "video":
      return <VideoIcon width={20} height={20} />;
    case "audio":
      return <MusicIcon width={20} height={20} />;
    case "archive":
      return <ArchiveIcon width={20} height={20} />;
    case "code":
      return <CodeIcon width={20} height={20} />;
    case "pdf":
      return <FileTextIcon width={20} height={20} />;
    case "app":
      return <AppIcon width={20} height={20} />;
    case "doc":
      return <FileTextIcon width={20} height={20} />;
    default:
      return <FileIcon width={20} height={20} />;
  }
}

function StatusBadge({ status, retries }: { status: DownloadInfo["status"]; retries: number }) {
  const label =
    status === "queued"
      ? "Queued"
      : status === "downloading"
        ? "Downloading"
        : status === "retrying"
          ? `Retrying… (${retries})`
          : status === "paused"
            ? "Paused"
            : status === "completed"
              ? "Done"
              : status === "cancelled"
                ? "Cancelled"
                : "Failed";
  return <span className={`badge badge-${status}`}>{label}</span>;
}

function ActionBtn({
  title,
  onClick,
  children,
  tone,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  tone?: "danger" | "ok";
}) {
  return (
    <button
      className={`card-action${tone === "danger" ? " card-action-danger" : tone === "ok" ? " card-action-ok" : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function useSpeedHistory(id: string, speed: number) {
  const store = useRef(new Map<string, number[]>());
  useEffect(() => {
    if (speed <= 0) return;
    const map = store.current;
    const hist = map.get(id) ?? [];
    hist.push(speed);
    if (hist.length > 26) hist.shift();
    map.set(id, hist);
    // prune entries for downloads that no longer exist
    if (map.size > 80) {
      const keys = [...map.keys()];
      for (const k of keys.slice(0, keys.length - 60)) map.delete(k);
    }
  }, [id, speed]);
  return store.current.get(id) ?? [];
}

function SpeedSpark({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const w = 62;
  const h = 20;
  const max = Math.max(...history, 1);
  const pts = history
    .map(
      (v, i) =>
        `${((i / (history.length - 1)) * (w - 2) + 1).toFixed(1)},${(
          h - 1.5 - (v / max) * (h - 4)
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      className="spark"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DownloadCard({
  d,
  index,
  onContext,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onRemove,
  onOpenFile,
  onOpenFolder,
  onCopy,
}: {
  d: DownloadInfo;
  index?: number;
  onContext: (d: DownloadInfo, e: React.MouseEvent) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (d: DownloadInfo) => void;
  onOpenFile: (d: DownloadInfo) => void;
  onOpenFolder: (d: DownloadInfo) => void;
  onCopy: (d: DownloadInfo) => void;
}) {
  const kind = fileKindOf(d.filename);
  const color = KIND_COLOR[kind];
  const percent = d.totalSize ? Math.min(100, (d.received / d.totalSize) * 100) : null;
  const remaining = d.totalSize ? d.totalSize - d.received : 0;
  const running = d.status === "downloading" || d.status === "retrying";
  const finished = d.status === "completed";
  const failed = d.status === "failed" || d.status === "cancelled";
  const history = useSpeedHistory(d.id, d.speed);

  return (
    <div
      className={`card${failed ? " card-failed" : ""}`}
      style={{ animationDelay: `${Math.min(index ?? 0, 10) * 32}ms` }}
      onContextMenu={(e) => onContext(d, e)}
    >
      <div
        className="card-icon"
        style={{ background: `${color}1f`, color }}
        title={`${kind} file`}
      >
        <KindIcon kind={kind} />
      </div>

      <div className="card-body">
        <div className="card-top">
          <span className="card-name" title={d.filename}>
            {d.filename}
          </span>
          <div className="card-chips">
            {d.segmented && (
              <span className="chip chip-accent" title="Multi-connection download">
                <BoltIcon width={11} height={11} />
                {d.segments.length}×
              </span>
            )}
            {d.speedLimit > 0 && (
              <span className="chip" title="Per-download speed limit">
                ≤ {formatBytes(d.speedLimit)}/s
              </span>
            )}
            {d.status === "downloading" && !d.totalSize && (
              <span className="chip">size unknown</span>
            )}
            <StatusBadge status={d.status} retries={d.retries} />
          </div>
        </div>

        <div className="card-bar">
          <div
            className={`card-bar-fill${percent === null ? " card-bar-indet" : ""}${d.status === "completed" ? " card-bar-done" : ""}`}
            style={percent !== null ? { width: `${percent}%` } : undefined}
          />
        </div>

        <div className="card-meta">
          <span className="meta-left">
            {d.totalSize ? (
              <>
                {formatBytes(d.received)} <span className="meta-dim">of</span>{" "}
                {formatBytes(d.totalSize)}
                {percent !== null && (
                  <span className="meta-pct">· {Math.floor(percent)}%</span>
                )}
              </>
            ) : (
              <>{formatBytes(d.received)} downloaded</>
            )}
          </span>
          <span className="meta-right">
            {running && (
              <span className="meta-speed">
                <span className="speed-pulse" />
                {formatSpeed(d.speed)}
                <SpeedSpark history={history} />
              </span>
            )}
            {running && d.totalSize && (
              <span className="meta-dim">{formatEta(remaining, d.speed)} left</span>
            )}
            {d.status === "completed" && d.completedAt ? (
              <span className="meta-dim">{formatDate(d.completedAt)}</span>
            ) : null}
            {d.status === "paused" && (
              <span className="meta-dim">Resumable — {formatBytes(d.received)} saved</span>
            )}
          </span>
        </div>

        {failed && d.error && (
          <div className="card-error" title={d.error}>
            {d.error.length > 140 ? d.error.slice(0, 140) + "…" : d.error}
          </div>
        )}

        <div className="card-actions">
          {running && (
            <ActionBtn title="Pause" onClick={() => onPause(d.id)}>
              <PauseIcon width={15} height={15} />
            </ActionBtn>
          )}
          {d.status === "paused" && (
            <ActionBtn title="Resume" onClick={() => onResume(d.id)}>
              <PlayIcon width={15} height={15} />
            </ActionBtn>
          )}
          {failed && (
            <ActionBtn title="Try again" onClick={() => onRetry(d.id)}>
              <RefreshIcon width={15} height={15} />
            </ActionBtn>
          )}
          {running && (
            <ActionBtn title="Cancel" tone="danger" onClick={() => onCancel(d.id)}>
              <XIcon width={15} height={15} />
            </ActionBtn>
          )}
          {finished && (
            <ActionBtn title="Open file" tone="ok" onClick={() => onOpenFile(d)}>
              <ExternalIcon width={15} height={15} />
            </ActionBtn>
          )}
          {!running && (
            <ActionBtn title="Show in folder" onClick={() => onOpenFolder(d)}>
              <FolderIcon width={15} height={15} />
            </ActionBtn>
          )}
          <ActionBtn title="Copy link" onClick={() => onCopy(d)}>
            <LinkIcon width={15} height={15} />
          </ActionBtn>
          <ActionBtn title="Remove" tone="danger" onClick={() => onRemove(d)}>
            <TrashIcon width={15} height={15} />
          </ActionBtn>
        </div>
      </div>
    </div>
  );
}
