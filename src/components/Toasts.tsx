import type { Dispatch, SetStateAction } from "react";
import type { Toast } from "../types";
import { CheckCircleIcon, XIcon, SparklesIcon } from "../lib/icons";

let toastCounter = 0;

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">
            {t.kind === "success" ? (
              <CheckCircleIcon width={15} height={15} />
            ) : t.kind === "error" ? (
              <XIcon width={15} height={15} />
            ) : (
              <SparklesIcon width={15} height={15} />
            )}
          </span>
          <span className="toast-msg">{t.msg}</span>
          <button
            className="toast-close"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
          >
            <XIcon width={13} height={13} />
          </button>
          <span className="toast-timer" aria-hidden />
        </div>
      ))}
    </div>
  );
}

export function pushToast(
  setToasts: Dispatch<SetStateAction<Toast[]>>,
  msg: string,
  kind: Toast["kind"] = "info",
) {
  const id = ++toastCounter;
  setToasts((t) => [...t.slice(-4), { id, msg, kind }]);
  window.setTimeout(() => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, 4200);
}

export function dismissToast(
  setToasts: Dispatch<SetStateAction<Toast[]>>,
  id: number,
) {
  setToasts((t) => t.filter((x) => x.id !== id));
}
