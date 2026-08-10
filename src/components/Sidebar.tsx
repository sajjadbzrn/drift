import type { Filter } from "../types";
import {
  ActivityIcon,
  CheckCircleIcon,
  GridIcon,
  MoonIcon,
  PauseAllIcon,
  PauseIcon,
  PlayAllIcon,
  SettingsIcon,
  SunIcon,
  XIcon,
} from "../lib/icons";
import { formatBytes, formatSpeed } from "../lib/format";
import { useI18n, num } from "../lib/i18n";

export function Sidebar({
  filter,
  onFilter,
  counts,
  totalSpeed,
  peakSpeed,
  totalBytes,
  activeCount,
  maxConcurrent,
  onMaxConcurrent,
  theme,
  onToggleTheme,
  onOpenSettings,
  onPauseAll,
  onResumeAll,
}: {
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: Record<Filter, number>;
  totalSpeed: number;
  peakSpeed: number;
  totalBytes: number;
  activeCount: number;
  maxConcurrent: number;
  onMaxConcurrent: (v: number) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
}) {
  const t = useI18n();
  const FILTERS: { id: Filter; label: string; icon: typeof GridIcon }[] = [
    { id: "all", label: t("allDownloads"), icon: GridIcon },
    { id: "active", label: t("active"), icon: ActivityIcon },
    { id: "completed", label: t("completed"), icon: CheckCircleIcon },
    { id: "paused", label: t("paused"), icon: PauseIcon },
    { id: "failed", label: t("failed"), icon: XIcon },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          <img className="brand-logo" src="/drift.png" alt="drift" draggable={false} />
        </span>
        <div className="brand-text">
          <span className="brand-name">{t("appName")}</span>
          <span className="brand-tag">{t("tagline")}</span>
        </div>
      </div>

      <nav className="nav">
        <span className="nav-label">{t("library")}</span>
        {FILTERS.map(({ id, label, icon: Icon }) => {
          const active = filter === id;
          return (
            <button
              key={id}
              className={`nav-item${active ? " nav-item-active" : ""}`}
              onClick={() => onFilter(id)}
            >
              <Icon width={17} height={17} />
              <span className="nav-item-label">{label}</span>
              {counts[id] > 0 && <span className="nav-count">{num(counts[id])}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <div className="stat-card">
          <div className="stat-row">
            <span className="stat-label">
              {activeCount > 0 ? t("downloading") : t("idle")}
            </span>
            <span className={`stat-dot${activeCount > 0 ? " stat-dot-on" : ""}`} />
          </div>
          <div className="stat-value">{formatSpeed(totalSpeed)}</div>
          <div className="stat-sub">
            {activeCount > 0
              ? t("activeTransfers", { n: num(activeCount) })
              : t("noActiveTransfers")}
          </div>
          <div className="stat-grid">
            <div className="stat-mini">
              <span className="stat-mini-label">{t("total")}</span>
              <span className="stat-mini-value" title={t("totalTitle")}>
                {activeCount > 0 ? formatBytes(totalBytes) : "—"}
              </span>
            </div>
            <div className="stat-mini">
              <span className="stat-mini-label">{t("peak")}</span>
              <span className="stat-mini-value" title={t("peakTitle")}>
                {formatSpeed(peakSpeed)}
              </span>
            </div>
          </div>
        </div>

        <div className="concurrent-section">
          <span className="concurrent-label">{t("concurrent")}</span>
          <div className="concurrent-group">
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <button
                key={n}
                className={`concurrent-chip${maxConcurrent === n ? " concurrent-chip-on" : ""}`}
                onClick={() => onMaxConcurrent(n)}
                title={t("concurrentTitle", { n: num(n) })}
              >
                {num(n)}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-queue">
          <button
            className="btn-ghost btn-sm"
            onClick={onPauseAll}
            disabled={activeCount === 0}
            title={t("pauseAllTitle")}
          >
            <PauseAllIcon width={14} height={14} />
            {t("pauseAll")}
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={onResumeAll}
            disabled={counts.paused === 0}
            title={t("resumeAllTitle")}
          >
            <PlayAllIcon width={14} height={14} />
            {t("resumeAll")}
          </button>
        </div>

        <div className="sidebar-actions">
          <button
            className="icon-btn"
            onClick={onToggleTheme}
            title={t("toggleTheme")}
            aria-label={t("toggleTheme")}
          >
            {theme === "dark" ? (
              <SunIcon width={17} height={17} />
            ) : (
              <MoonIcon width={17} height={17} />
            )}
          </button>
          <button
            className="icon-btn"
            onClick={onOpenSettings}
            title={t("settings")}
            aria-label={t("settings")}
          >
            <SettingsIcon width={17} height={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}
