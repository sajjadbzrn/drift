import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { DownloadInfo, Filter } from "../types";
import { DownloadCard } from "./DownloadCard";
import { InboxIcon, ActivityIcon, CheckCircleIcon, PauseIcon, XIcon } from "../lib/icons";
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
const ROW_HEIGHT = 164;
/** Extra rows rendered above and below the viewport for smooth scrolling. */
const OVERSCAN = 4;
/** Above this many rows the list renders only the visible window. */
const VIRTUALIZE_OVER = 30;

export const DownloadList = memo(function DownloadList({
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
}) {
  const t = useI18n();

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // The list behaves as a single tab stop (roving selection lives in App, which
  // owns the keyboard handler), so it exposes itself as a real listbox and
  // reports the focused row through aria-activedescendant.
  const activeId =
    selectedIds.size > 0 ? [...selectedIds][selectedIds.size - 1] : undefined;
  const listProps = {
    role: "listbox" as const,
    "aria-multiselectable": true,
    "aria-label": t("downloadsListLabel"),
    "aria-activedescendant": activeId ? `dl-${activeId}` : undefined,
    tabIndex: 0,
  };

  // Drag & drop queue reorder state (ids, resolved to indexes in App).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Mirrored in refs so the drag callbacks stay referentially stable and don't
  // invalidate every memoized card when the drag state changes.
  const dragIdRef = useRef<string | null>(null);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

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
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
  }, []);

  const handleDragStart = useCallback((id: string) => {
    dragIdRef.current = id;
    setDragId(id);
  }, []);

  const handleDragOver = useCallback((id: string, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverId(id);
  }, []);

  const handleDrop = useCallback(
    (id: string, e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const drag = dragIdRef.current;
      if (drag && drag !== id) onReorderRef.current(drag, id);
      endDrag();
    },
    [endDrag],
  );

  const activate = useCallback(
    (d: DownloadInfo) => {
      if (d.status === "completed") onOpenFile(d);
      else onOpenFolder(d);
    },
    [onOpenFile, onOpenFolder],
  );

  const renderCard = (d: DownloadInfo, index: number) => (
    <DownloadCard
      key={d.id}
      d={d}
      index={index}
      queuePos={d.status === "queued" ? index + 1 : 0}
      selected={selectedIds.has(d.id)}
      dragging={dragId === d.id}
      dropTarget={overId === d.id && dragId !== d.id}
      onSelect={onSelect}
      onActivate={activate}
      onDragStart={handleDragStart}
      onDragEnd={endDrag}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContext={onContext}
      onPause={onPause}
      onResume={onResume}
      onRetry={onRetry}
      onCancel={onCancel}
      onRemove={onRemove}
      onOpenFile={onOpenFile}
      onOpenFolder={onOpenFolder}
      onCopy={onCopy}
    />
  );

  // Regular render when the list is small enough that virtualization overhead
  // would be pointless.
  if (downloads.length <= VIRTUALIZE_OVER) {
    if (downloads.length === 0) {
      const keys = EMPTY_KEYS[filter];
      const Icon = EMPTY_ICONS[filter];
      return (
        <div className="empty">
          <div className="empty-icon">
            {filter === "all" ? (
              <img
                className="empty-logo"
                src="/drift.png"
                alt=""
                width={44}
                height={44}
                draggable={false}
              />
            ) : (
              <Icon width={30} height={30} />
            )}
          </div>
          <span className="empty-title">{t(keys.title)}</span>
          <span className="empty-sub">{t(keys.sub)}</span>
        </div>
      );
    }
    return (
      <div className="list" ref={containerRef} onScroll={onScroll} {...listProps}>
        {downloads.map((d, i) => renderCard(d, i))}
      </div>
    );
  }

  const totalHeight = downloads.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(
    downloads.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = downloads.slice(startIdx, endIdx);
  const offsetY = startIdx * ROW_HEIGHT;

  return (
    <div className="list" ref={containerRef} onScroll={onScroll} {...listProps}>
      <div style={{ height: totalHeight, position: "relative" }} role="presentation">
        <div
          style={{ position: "absolute", top: offsetY, width: "100%" }}
          role="presentation"
        >
          {visible.map((d, i) => renderCard(d, startIdx + i))}
        </div>
      </div>
    </div>
  );
});
