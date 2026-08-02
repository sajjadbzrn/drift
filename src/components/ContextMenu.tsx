import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  separator?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth, innerHeight } = window;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, innerWidth - rect.width - 8),
      y: Math.min(y, innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("contextmenu", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("contextmenu", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) => {
        if (it.separator) {
          return <div key={`sep-${i}`} className="ctx-sep" />;
        }
        return (
          <button
            key={`${it.label}-${i}`}
            className={`ctx-item${it.danger ? " ctx-item-danger" : ""}`}
            onClick={() => {
              it.onClick?.();
              onClose();
            }}
          >
            {it.icon && <span className="ctx-icon">{it.icon}</span>}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
