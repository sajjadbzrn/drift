import type { Filter } from "../types";
import {
  ActivityIcon,
  CheckCircleIcon,
  GridIcon,
  MoonIcon,
  PauseIcon,
  SettingsIcon,
  SunIcon,
  XIcon,
} from "../lib/icons";
import { useI18n, num } from "../lib/i18n";

type Counts = Record<Filter, number>;

const FILTERS: { id: Filter; key: string; icon: typeof GridIcon }[] = [
  { id: "all", key: "tabAll", icon: GridIcon },
  { id: "active", key: "tabActive", icon: ActivityIcon },
  { id: "completed", key: "tabCompleted", icon: CheckCircleIcon },
  { id: "paused", key: "tabPaused", icon: PauseIcon },
  { id: "failed", key: "tabFailed", icon: XIcon },
];

/**
 * Mobile app bar: replaces the desktop titlebar + sidebar. Shows the brand,
 * quick theme/settings actions, and the library filter tabs as a horizontal
 * scroll (so it never overflows on narrow phones).
 */
export function MobileBar({
  filter,
  onFilter,
  counts,
  theme,
  onToggleTheme,
  onOpenSettings,
}: {
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: Counts;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}) {
  const t = useI18n();
  return (
    <header className="mobile-bar">
      <div className="mobile-bar-top">
        <img className="brand-logo" src="/drift.png" alt="drift" draggable={false} />
        <span className="brand-name">{t("appName")}</span>
        <div className="mobile-bar-actions">
          <button
            className="icon-btn"
            onClick={onToggleTheme}
            title={t("toggleTheme")}
            aria-label={t("toggleTheme")}
          >
            {theme === "dark" ? <SunIcon width={19} height={19} /> : <MoonIcon width={19} height={19} />}
          </button>
          <button
            className="icon-btn"
            onClick={onOpenSettings}
            title={t("settings")}
            aria-label={t("settings")}
          >
            <SettingsIcon width={19} height={19} />
          </button>
        </div>
      </div>

      <nav className="mobile-tabs" aria-label={t("library")}>
        {FILTERS.map(({ id, key, icon: Icon }) => {
          const active = filter === id;
          const count = counts[id];
          return (
            <button
              key={id}
              className={`mobile-tab${active ? " mobile-tab-on" : ""}`}
              onClick={() => onFilter(id)}
            >
              <Icon width={15} height={15} />
              <span>{t(key)}</span>
              {count > 0 && <span className="tab-count">{num(count)}</span>}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
