import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDownIcon, CheckCircleIcon } from "../lib/icons";

export interface SortOption {
  value: string;
  label: string;
}

/**
 * Custom list-sort control: a trigger button that opens a small dropdown panel.
 * Replaces the native <select>, whose OS-rendered popup looks out of place in a
 * Tauri/WebView window. Keyboard-friendly (Escape closes, ARIA listbox) and
 * dismisses on outside click or window blur.
 */
export function SortMenu({
  value,
  options,
  onSort,
  ariaLabel,
}: {
  value: string;
  options: SortOption[];
  onSort: (v: string) => void;
  ariaLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Position the (fixed) panel below the trigger, clamped to the window.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !menuRef.current) return;
    const wrap = wrapRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const menuRect = menu.getBoundingClientRect();
    const top = Math.min(wrap.bottom + 6, innerHeight - menuRect.height - 8);
    const left = Math.min(wrap.left, innerWidth - menuRect.width - 8);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", () => setOpen(false));
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", () => setOpen(false));
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="sort-wrap" ref={wrapRef}>
      <button
        type="button"
        className="sort-trigger"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="sort-trigger-prefix">{ariaLabel}</span>
        <span className="sort-trigger-value">{current?.label}</span>
        <ChevronDownIcon width={14} height={14} />
      </button>

      {open && (
        <div className="sort-menu" ref={menuRef} role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`sort-item${o.value === value ? " sort-item-on" : ""}`}
              onClick={() => {
                onSort(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.value === value && <CheckCircleIcon width={14} height={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}