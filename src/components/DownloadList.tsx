import type { DownloadInfo, Filter } from "../types";
import { DownloadCard } from "./DownloadCard";
import { InboxIcon, ActivityIcon, CheckCircleIcon, PauseIcon, XIcon } from "../lib/icons";

const EMPTY: Record<Filter, { icon: typeof InboxIcon; title: string; sub: string }> = {
  all: {
    icon: InboxIcon,
    title: "No downloads yet",
    sub: "Paste a link above to start your first download.",
  },
  active: {
    icon: ActivityIcon,
    title: "Nothing in progress",
    sub: "Active and queued downloads will show up here.",
  },
  completed: {
    icon: CheckCircleIcon,
    title: "No completed downloads",
    sub: "Finished files will be listed here.",
  },
  paused: {
    icon: PauseIcon,
    title: "Nothing paused",
    sub: "Paused downloads wait here until you resume them.",
  },
  failed: {
    icon: XIcon,
    title: "No failed downloads",
    sub: "Failed or cancelled downloads show up here.",
  },
};

export function DownloadList({
  downloads,
  filter,
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
  if (downloads.length === 0) {
    const e = EMPTY[filter];
    const Icon = e.icon;
    return (
      <div className="empty">
        <div className="empty-icon">
          <Icon width={30} height={30} />
        </div>
        <span className="empty-title">{e.title}</span>
        <span className="empty-sub">{e.sub}</span>
      </div>
    );
  }

  return (
    <div className="list">
      {downloads.map((d, i) => (
        <DownloadCard
          key={d.id}
          d={d}
          index={i}
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
      ))}
    </div>
  );
}
