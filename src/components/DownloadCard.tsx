import { memo, useEffect, useRef, useState, type ReactNode } from "react";
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
  CheckCircleIcon,
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
import { useI18n, num } from "../lib/i18n";

const KIND_KEYS: Record<ReturnType<typeof fileKindOf>, string> = {
  image: "kindImage",
  video: "kindVideo",
  audio: "kindAudio",
  archive: "kindArchive",
  code: "kindCode",
  doc: "kindDoc",
  pdf: "kindPdf",
  app: "kindApp",
  sheet: "kindSheet",
  slides: "kindSlides",
  file: "kindFile",
};

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
  const t = useI18n();
  const key =
    status === "queued"
      ? "badgeQueued"
      : status === "downloading"
        ? "badgeDownloading"
        : status === "retrying"
          ? "badgeRetrying"
          : status === "paused"
            ? "badgePaused"
            : status === "completed"
              ? "badgeDone"
              : status === "cancelled"
                ? "badgeCancelled"
                : "badgeFailed";
  const label = key === "badgeRetrying" ? t(key, { n: num(retries) }) : t(key);
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

/**
 * One slim bar per connection for a segmented download. Each fill is that
 * segment's share of its own byte range, so a lagging segment is obvious at a
 * glance. Purely presentational — the values come from the backend's
 * per-segment progress ticks.
 */
function SegmentBars({ d }: { d: DownloadInfo }) {
  const t = useI18n();
  return (
    <div
      className="seg-bars"
      role="img"
      aria-label={t("segmentsLabel", { n: num(d.segments.length) })}
    >
      {d.segments.map((s) => {
        const expected = Math.max(1, s.end - s.start + 1);
        const pct = Math.max(0, Math.min(100, (s.received / expected) * 100));
        const done = pct >= 99.95;
        return (
          <span
            className={`seg-bar${done ? " seg-bar-done" : ""}`}
            key={s.index}
            title={t("segmentBarTitle", {
              i: num(s.index + 1),
              pct: num(Math.floor(pct)),
            })}
          >
            <span className="seg-bar-fill" style={{ width: `${pct}%` }} />
          </span>
        );
      })}
    </div>
  );
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
  const area = `${pts} ${w - 1},${h} 1,${h}`;
  return (
    <svg
      className="spark"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
    >
      <polygon points={area} fill="currentColor" opacity="0.16" />
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

export const DownloadCard = memo(function DownloadCard({
  d,
  index,
  queuePos,
  selected,
  onSelect,
  onActivate,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
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
  queuePos?: number;
  selected?: boolean;
  /** All handlers are id-based and stable so `memo` can skip untouched cards. */
  onSelect?: (id: string, multi: boolean) => void;
  onActivate?: (d: DownloadInfo) => void;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onDragOver?: (id: string, e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (id: string, e: React.DragEvent<HTMLDivElement>) => void;
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
  const t = useI18n();
  const kind = fileKindOf(d.filename);
  const color = KIND_COLOR[kind];
  const percent = d.totalSize ? Math.min(100, (d.received / d.totalSize) * 100) : null;
  const remaining = d.totalSize ? Math.max(0, d.totalSize - d.received) : null;
  const running = d.status === "downloading" || d.status === "retrying";
  const finished = d.status === "completed";
  const failed = d.status === "failed" || d.status === "cancelled";
  const history = useSpeedHistory(d.id, d.speed);
  const [folderJustOpened, setFolderJustOpened] = useState(false);
  // Flash the icon with a ring burst when a download flips to completed.
  const prevStatus = useRef(d.status);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    if (d.status === "completed") {
      if (prevStatus.current !== "completed") {
        setJustDone(true);
        const id = window.setTimeout(() => setJustDone(false), 1000);
        prevStatus.current = d.status;
        return () => window.clearTimeout(id);
      }
    } else {
      setJustDone(false);
    }
    prevStatus.current = d.status;
  }, [d.status]);

  // Track the cursor so the card can paint a soft spotlight under it.
  const onCardMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${(e.clientX - r.left).toFixed(1)}px`);
    e.currentTarget.style.setProperty("--my", `${(e.clientY - r.top).toFixed(1)}px`);
  };

  return (
    <div
      id={`dl-${d.id}`}
      role="option"
      aria-selected={!!selected}
      aria-label={d.filename}
      className={`card${failed ? " card-failed" : ""}${selected ? " card-selected" : ""}${dragging ? " card-dragging" : ""}${dropTarget ? " card-drop-target" : ""}${justDone ? " card-just-done" : ""}`}
      draggable={typeof onDragStart === "function"}
      style={
        {
          animationDelay: `${Math.min(index ?? 0, 10) * 32}ms`,
          "--kind": color,
        } as React.CSSProperties
      }
      onContextMenu={(e) => onContext(d, e)}
      onMouseMove={onCardMove}
      onClick={(e) => {
        if (onSelect) {
          e.preventDefault();
          onSelect(d.id, e.ctrlKey || e.metaKey || e.shiftKey);
        }
      }}
      onDoubleClick={() => onActivate?.(d)}
      onDragStart={() => onDragStart?.(d.id)}
      onDragEnd={() => onDragEnd?.()}
      onDragOver={(e) => onDragOver?.(d.id, e)}
      onDrop={(e) => onDrop?.(d.id, e)}
    >
      <div
        className="card-icon"
        style={{ background: `${color}1f`, color }}
        title={t(KIND_KEYS[kind])}
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
              <span className="chip chip-accent" title={t("segmentedTitle")}>
                <BoltIcon width={11} height={11} />
                {num(d.segments.length)}×
              </span>
            )}
            {d.hash && d.verified && (
              <span className="chip chip-ok" title={t("verified")}>
                <CheckCircleIcon width={11} height={11} />
              </span>
            )}
            {d.speedLimit > 0 && (
              <span className="chip" title={t("speedLimitChipTitle")}>
                {t("speedLimitChip", { v: formatBytes(d.speedLimit) })}
              </span>
            )}
            {d.status === "queued" && queuePos && queuePos > 0 && (
              <span className="chip" title={t("queuePosTitle", { n: num(queuePos) })}>
                #{num(queuePos)}
              </span>
            )}
            <StatusBadge status={d.status} retries={d.retries} />
          </div>
        </div>

        <div className="card-bar">
          <div
            className={`card-bar-fill${percent === null ? " card-bar-indet" : ""}${d.status === "completed" ? " card-bar-done" : ""}${d.status === "paused" ? " card-bar-paused" : ""}`}
            style={percent !== null ? { width: `${percent}%` } : undefined}
          />
        </div>

        {d.segmented && d.segments.length > 1 && !finished && !failed && (
          <SegmentBars d={d} />
        )}

        <div className="card-meta">
          <span className="meta-left">
            {d.totalSize ? (
              <>
                {formatBytes(d.received)} <span className="meta-dim">{t("of")}</span>{" "}
                {formatBytes(d.totalSize)}
                {percent !== null && (
                  <span className="meta-pct">{num(Math.floor(percent))}%</span>
                )}
              </>
            ) : running ? (
              <>
                {formatBytes(d.received)}{" "}
                <span className="meta-dim">{t("determiningSize")}</span>
              </>
            ) : (
              <>{t("downloaded", { v: formatBytes(d.received) })}</>
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
            {running && d.totalSize && remaining !== null && (
              <span className="meta-dim">
                {t("remaining", { v: formatBytes(remaining) })}
              </span>
            )}
            {running && d.totalSize && remaining !== null && (
              <span className="meta-dim">
                {t("left", { v: formatEta(remaining, d.speed) })}
              </span>
            )}
            {d.status === "completed" && d.completedAt ? (
              <span className="meta-dim">{formatDate(d.completedAt)}</span>
            ) : null}
            {d.status === "paused" && (
              <span className="meta-dim">
                {d.totalSize
                  ? t("savedOf", {
                      a: formatBytes(d.received),
                      b: formatBytes(d.totalSize),
                    })
                  : t("resumable", { v: formatBytes(d.received) })}
              </span>
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
            <ActionBtn title={t("pause")} onClick={() => onPause(d.id)}>
              <PauseIcon width={15} height={15} />
            </ActionBtn>
          )}
          {d.status === "paused" && (
            <ActionBtn title={t("resume")} onClick={() => onResume(d.id)}>
              <PlayIcon width={15} height={15} />
            </ActionBtn>
          )}
          {failed && (
            <ActionBtn title={t("tryAgain")} onClick={() => onRetry(d.id)}>
              <RefreshIcon width={15} height={15} />
            </ActionBtn>
          )}
          {running && (
            <ActionBtn title={t("cancel")} tone="danger" onClick={() => onCancel(d.id)}>
              <XIcon width={15} height={15} />
            </ActionBtn>
          )}
          {finished && (
            <ActionBtn title={t("openFile")} tone="ok" onClick={() => onOpenFile(d)}>
              <ExternalIcon width={15} height={15} />
            </ActionBtn>
          )}
          {!running && (
            <ActionBtn
              title={t("showInFolder")}
              onClick={() => {
                if (folderJustOpened) return;
                setFolderJustOpened(true);
                setTimeout(() => setFolderJustOpened(false), 300);
                onOpenFolder(d);
              }}
            >
              <FolderIcon width={15} height={15} />
            </ActionBtn>
          )}
          <ActionBtn title={t("copyLink")} onClick={() => onCopy(d)}>
            <LinkIcon width={15} height={15} />
          </ActionBtn>
          <ActionBtn title={t("remove")} tone="danger" onClick={() => onRemove(d)}>
            <TrashIcon width={15} height={15} />
          </ActionBtn>
        </div>
      </div>
    </div>
  );
});
