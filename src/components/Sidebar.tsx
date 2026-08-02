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

const FILTERS: { id: Filter; label: string; icon: typeof GridIcon }[] = [
  { id: "all", label: "All downloads", icon: GridIcon },
  { id: "active", label: "Active", icon: ActivityIcon },
  { id: "completed", label: "Completed", icon: CheckCircleIcon },
  { id: "paused", label: "Paused", icon: PauseIcon },
  { id: "failed", label: "Failed", icon: XIcon },
];

export function Sidebar({
  filter,
  onFilter,
  counts,
  totalSpeed,
  peakSpeed,
  totalBytes,
  activeCount,
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
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-logo" src="/drift.png" alt="drift" draggable={false} />
        <div className="brand-text">
          <span className="brand-name">drift</span>
          <span className="brand-tag">download manager</span>
        </div>
      </div>

      <nav className="nav">
        <span className="nav-label">Library</span>
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
              {counts[id] > 0 && <span className="nav-count">{counts[id]}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <div className="stat-card">
          <div className="stat-row">
            <span className="stat-label">
              {activeCount > 0 ? "Downloading" : "Idle"}
            </span>
            <span className={`stat-dot${activeCount > 0 ? " stat-dot-on" : ""}`} />
          </div>
          <div className="stat-value">{formatSpeed(totalSpeed)}</div>
          <div className="stat-sub">
            {activeCount > 0
              ? `${activeCount} active transfer${activeCount === 1 ? "" : "s"}`
              : "No active transfers"}
          </div>
          <div className="stat-grid">
            <div className="stat-mini">
              <span className="stat-mini-label">Total</span>
              <span className="stat-mini-value" title="Bytes pulled by drift">
                {formatBytes(totalBytes)}
              </span>
            </div>
            <div className="stat-mini">
              <span className="stat-mini-label">Peak</span>
              <span className="stat-mini-value" title="Fastest speed this session">
                {formatSpeed(peakSpeed)}
              </span>
            </div>
          </div>
        </div>

        <div className="sidebar-queue">
          <button
            className="btn-ghost btn-sm"
            onClick={onPauseAll}
            disabled={activeCount === 0}
            title="Pause all active downloads"
          >
            <PauseAllIcon width={14} height={14} />
            Pause all
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={onResumeAll}
            disabled={counts.paused === 0}
            title="Resume all paused downloads"
          >
            <PlayAllIcon width={14} height={14} />
            Resume all
          </button>
        </div>

        <div className="sidebar-actions">
          <button
            className="icon-btn"
            onClick={onToggleTheme}
            title="Toggle theme"
            aria-label="Toggle theme"
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
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon width={17} height={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}
