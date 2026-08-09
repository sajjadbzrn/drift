import { useEffect, useState } from "react";
import type { DownloadInfo } from "../types";
import { useI18n } from "../lib/i18n";
import { XIcon } from "../lib/icons";

/** Modal for editing a download's speed limit (MB/s, 0 = unlimited). */
export function SpeedLimitModal({
  d,
  onClose,
  onSave,
}: {
  d: DownloadInfo;
  onClose: () => void;
  onSave: (mbPerSec: number) => void;
}) {
  const t = useI18n();
  const [value, setValue] = useState<string>(
    d.speedLimit > 0 ? String(d.speedLimit / (1024 * 1024)) : "",
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (mb: number) => {
    onSave(mb);
    onClose();
  };

  const parseAndSubmit = () => {
    const v = parseFloat(value);
    submit(Number.isFinite(v) && v > 0 ? v : 0);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{t("speedLimitTitle")}</span>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            <XIcon width={16} height={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="setting-row">
            <span className="setting-text">
              <span className="setting-label" title={d.filename}>
                {d.filename}
              </span>
              <span className="setting-desc">{t("speedLimitDesc")}</span>
            </span>
          </div>
          <div className="limit-edit-row">
            <div className="number-field">
              <input
                type="number"
                min={0}
                max={1000}
                step={0.5}
                value={value}
                autoFocus
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") parseAndSubmit();
                }}
                placeholder="0"
                aria-label={t("speedLimitTitle")}
              />
              <span className="number-unit">MB/s</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => submit(0)}>
              {t("unlimited")}
            </button>
            <button className="btn btn-primary btn-sm" onClick={parseAndSubmit}>
              {t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
