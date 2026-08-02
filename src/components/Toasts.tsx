import type { Dispatch, SetStateAction } from "react";
import type { Toast, ToastAction } from "../types";
import { CheckCircleIcon, XIcon, SparklesIcon } from "../lib/icons";
import { useI18n } from "../lib/i18n";

let toastCounter = 0;

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const t = useI18n();
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-icon">
            {toast.kind === "success" ? (
              <CheckCircleIcon width={15} height={15} />
            ) : toast.kind === "error" ? (
              <XIcon width={15} height={15} />
            ) : (
              <SparklesIcon width={15} height={15} />
            )}
          </span>
          <span className="toast-msg">{toast.msg}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            className="toast-close"
            onClick={() => onDismiss(toast.id)}
            aria-label={t("dismiss")}
            title={t("dismiss")}
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
  action?: ToastAction,
) {
  const id = ++toastCounter;
  setToasts((t) => [...t.slice(-4), { id, msg, kind, action }]);
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
