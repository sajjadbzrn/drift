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
  const t = useI18n();
  if (downloads.length === 0) {
    const keys = EMPTY_KEYS[filter];
    const Icon = EMPTY_ICONS[filter];
    return (
      <div className="empty">
        <div className="empty-icon">
          <Icon width={30} height={30} />
        </div>
        <span className="empty-title">{t(keys.title)}</span>
        <span className="empty-sub">{t(keys.sub)}</span>
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
