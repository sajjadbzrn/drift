import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../lib/i18n";

const Win = () => getCurrentWindow();

function MinimizeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 12h16" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4.5" y="7.5" width="12" height="12" rx="1.5" />
      <path d="M8.5 7.5v-2A1.5 1.5 0 0 1 10 4h8.5A1.5 1.5 0 0 1 20 5.5V14a1.5 1.5 0 0 1-1.5 1.5h-2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Titlebar() {
  const t = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const w = Win();
        setMaximized(await w.isMaximized());
        const un = await w.onResized(() => {
          void Win()
            .isMaximized()
            .then((m) => alive && setMaximized(m));
        });
        if (!alive) un();
        else unlisten = un;
      } catch {
        // running outside a Tauri window (e.g. plain browser) — controls no-op
      }
    })();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const minimize = () => {
    try {
      void Win().minimize().catch(() => {});
    } catch {
      /* no-op */
    }
  };
  const toggleMax = () => {
    try {
      void Win().toggleMaximize().catch(() => {});
    } catch {
      /* no-op */
    }
  };
  const close = () => {
    try {
      void Win().close().catch(() => {});
    } catch {
      /* no-op */
    }
  };

  // Manual drag region (documented Tauri pattern): drag on left-drag, double-click maximizes.
  const onDragMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.detail === 2) {
      toggleMax();
      return;
    }
    try {
      void Win().startDragging().catch(() => {});
    } catch {
      /* no-op */
    }
  };

  return (
    <header className="titlebar">
      <div className="titlebar-left" onMouseDown={onDragMouseDown}>
        <img className="titlebar-logo" src="/drift.png" alt="drift" draggable={false} />
        <span className="titlebar-name">drift</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          onClick={minimize}
          title={t("minimize")}
          aria-label={t("minimize")}
        >
          <MinimizeIcon />
        </button>
        <button
          className="titlebar-btn"
          onClick={toggleMax}
          title={maximized ? t("restore") : t("maximize")}
          aria-label={maximized ? t("restore") : t("maximize")}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={close}
          title={t("close")}
          aria-label={t("close")}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
