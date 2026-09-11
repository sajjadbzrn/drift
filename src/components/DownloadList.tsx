import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DownloadInfo, Filter } from "../types";
import { DownloadCard } from "./DownloadCard";
import { InboxIcon, ActivityIcon, CheckCircleIcon, PauseIcon, XIcon, GridIcon } from "../lib/icons";
import { useI18n } from "../lib/i18n";

const EMPTY_KEYS: Record<Filter, { title: string; sub: string }> = {
  all: { title: "emptyAllTitle", sub: "emptyAllSub" },
  active: { title: "emptyActiveTitle", sub: "emptyActiveSub" },
  completed: { title: "emptyCompletedTitle", sub: "emptyCompletedSub" },
  paused: { title: "emptyPausedTitle", sub: "emptyPausedSub" },
  failed: { title: "emptyFailedTitle", sub: "emptyFailedSub" },
};
const EMPTY_ICONS: Record<Filter, typeof InboxIcon> = {
  all: InboxIcon,
  active: ActivityIcon,
  completed: CheckCircleIcon,
  paused: PauseIcon,
  failed: XIcon,
};

/** Estimated height of one card row (card + gap). Roughly constant. */
const ROW_HEIGHT = 152;
/** Compact rows are much shorter than full cards. */
const COMPACT_ROW_HEIGHT = 56;
/** Extra rows rendered above and below the viewport for smooth scrolling. */
const OVERSCAN = 4;

export type SortMode = "queue" | "date" | "size" | "speed";

export function DownloadList({
  downloads,
  filter,
  selectedIds,
  onSelect,
  onReorder,
  onContext,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onRemove,
  onOpenFile,
  onOpenFolder,
  onCopy,
  onOpenDetails,
  compact,
  sort,
}: {
  downloads: DownloadInfo[];
  filter: Filter;
  selectedIds: Set<string>;
  onSelect: (id: string, multi: boolean) => void;
  onReorder: (dragId: string, overId: string) => void;
  onContext: (d: DownloadInfo, e: React.MouseEvent) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (d: DownloadInfo) => void;
  onOpenFile: (d: DownloadInfo) => void;
  onOpenFolder: (d: DownloadInfo) => void;
  onCopy: (d: DownloadInfo) => void;
  onOpenDetails: (d: DownloadInfo) => void;
  compact: boolean;
  sort: SortMode;
}) {
  const t = useI18n();

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag & drop queue reorder state (ids, resolved to indexes in App).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
    },
    [],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const endDrag = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  // Non-queue sorts are computed here; "queue" keeps the incoming order.
  const sorted = useMemo(() => {
    if (sort === "queue") return downloads;
    const list = downloads.slice();
    if (sort === "date") list.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "size") list.sort((a, b) => (b.totalSize ?? 0) - (a.totalSize ?? 0));
    else if (sort === "speed") list.sort((a, b) => b.speed - a.speed);
    return list;
  }, [downloads, sort]);

  const renderCard = (d: DownloadInfo, index: number) => (
    <DownloadCard
      key={d.id}
      d={d}
      index={index}
      compact={compact}
      queuePos={d.status === "queued" ? index + 1 : 0}
      onContext={onContext}
      onPause={onPause}
      onResume={onResume}
      onRetry={onRetry}
      onCancel={onCancel}
      onRemove={onRemove}
      onOpenFile={onOpenFile}
      onOpenFolder={onOpenFolder}
      onCopy={onCopy}
      onOpenDetails={onOpenDetails}
      selected={selectedIds.has(d.id)}
      onSelect={(multi) => onSelect(d.id, multi)}
      onDoubleClick={() => {
        if (d.status === "completed") onOpenFile(d);
        else onOpenDetails(d);
      }}
      dragging={dragId === d.id}
      dropTarget={overId === d.id && dragId !== d.id}
      onDragStart={() => setDragId(d.id)}
      onDragEnd={endDrag}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOverId(d.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (dragId && dragId !== d.id) onReorder(dragId, d.id);
        endDrag();
      }}
    />
  );

  if (downloads.length === 0) {
    const keys = EMPTY_KEYS[filter];
    const Icon = EMPTY_ICONS[filter];
    return (
      <div className="empty">
        <div className="empty-icon">
          {filter === "all" ? (
            <img className="empty-logo" src="/drift.png" alt="" draggable={false} />
          ) : (
            <Icon width={30} height={30} />
          )}
        </div>
        <span className="empty-title">{t(keys.title)}</span>
        <span className="empty-sub">{t(keys.sub)}</span>
      </div>
    );
  }

  const rowHeight = compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;

  // Regular render when the list is small enough that virtualization overhead
  // would be pointless.
  if (sorted.length <= 30) {
    return (
      <div className={`list${compact ? " list-compact" : ""}`} ref={containerRef} onScroll={onScroll}>
        {sorted.map((d, i) => renderCard(d, i))}
      </div>
    );
  }

  const totalHeight = sorted.length * rowHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const endIdx = Math.min(sorted.length, Math.ceil((scrollTop + containerHeight) / rowHeight) + OVERSCAN);
  const visible = sorted.slice(startIdx, endIdx);
  const offsetY = startIdx * rowHeight;

  return (
    <div className={`list${compact ? " list-compact" : ""}`} ref={containerRef} onScroll={onScroll}>
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: offsetY, width: "100%" }}>
          {visible.map((d, i) => renderCard(d, startIdx + i))}
        </div>
      </div>
    </div>
  );
}

export { GridIcon };
