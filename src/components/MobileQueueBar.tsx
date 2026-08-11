import { formatSpeed } from "../lib/format";
import { useI18n, num } from "../lib/i18n";
import { PauseAllIcon, PlayAllIcon } from "../lib/icons";

/**
 * Mobile bottom bar: a fixed, thumb-reachable control for the global queue.
 * Replaces the sidebar's stats card + pause-all/resume-all buttons, which are
 * not visible in the mobile layout.
 */
export function MobileQueueBar({
  totalSpeed,
  activeCount,
  pausedCount,
  onPauseAll,
  onResumeAll,
}: {
  totalSpeed: number;
  activeCount: number;
  pausedCount: number;
  onPauseAll: () => void;
  onResumeAll: () => void;
}) {
  const t = useI18n();
  return (
    <div className="mobile-queue">
      <div className="mq-status">
        {activeCount > 0 ? (
          <>
            <span className="mq-dot" />
            <span className="mq-speed">{formatSpeed(totalSpeed)}</span>
            <span className="mq-sub">{t("activeTransfers", { n: num(activeCount) })}</span>
          </>
        ) : (
          <span className="mq-idle">{t("idle")}</span>
        )}
      </div>
      <div className="mq-actions">
        <button
          className="mq-btn"
          onClick={onPauseAll}
          disabled={activeCount === 0}
        >
          <PauseAllIcon width={16} height={16} />
          <span>{t("pauseAll")}</span>
        </button>
        <button
          className="mq-btn"
          onClick={onResumeAll}
          disabled={pausedCount === 0}
        >
          <PlayAllIcon width={16} height={16} />
          <span>{t("resumeAll")}</span>
        </button>
      </div>
    </div>
  );
}
