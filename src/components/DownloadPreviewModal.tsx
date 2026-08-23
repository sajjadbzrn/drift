import { useEffect } from "react";
import type { UrlMeta } from "../types";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  fileKindOf,
  type FileKind,
  KIND_COLOR,
} from "../lib/format";
import { useI18n } from "../lib/i18n";
import { ArrowDownIcon, XIcon, FileIcon } from "../lib/icons";

const KIND_KEY: Record<FileKind, string> = {
  image: "kindImage",
  video: "kindVideo",
  audio: "kindAudio",
  archive: "kindArchive",
  code: "kindCode",
  doc: "kindDoc",
  pdf: "kindPdf",
  app: "kindApp",
  sheet: "kindSheet",
  slides: "kindSlides",
  file: "kindFile",
};

export function DownloadPreviewModal({
  meta,
  name,
  limitBytes,
  onConfirm,
  onCancel,
}: {
  meta: UrlMeta;
  name: string;
  limitBytes: number | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useI18n();
  const kind = fileKindOf(name);
  const kindColor = KIND_COLOR[kind];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // The ETA uses the speed the download will actually move at: the user's
  // per-download cap when one is set, otherwise the measured connection speed.
  const effective =
    limitBytes && limitBytes > 0
      ? meta.speed
        ? Math.min(meta.speed, limitBytes)
        : limitBytes
      : meta.speed ?? null;
  const eta =
    meta.size && effective && effective > 0 ? formatEta(meta.size, effective) : null;
  const limited = !!(limitBytes && limitBytes > 0);

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{t("previewTitle")}</span>
          <button className="icon-btn" onClick={onCancel} aria-label={t("close")}>
            <XIcon width={16} height={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="dl-preview-file">
            <span className="dl-preview-icon" style={{ color: kindColor }}>
              <FileIcon width={20} height={20} />
            </span>
            <span className="dl-preview-name" title={name}>
              {name}
            </span>
          </div>

          <div className="dl-preview-stats">
            <div className="dl-stat">
              <span className="dl-stat-label">{t("previewSize")}</span>
              <span className="dl-stat-value">
                {meta.size ? formatBytes(meta.size) : "—"}
              </span>
            </div>
            <div className="dl-stat">
              <span className="dl-stat-label">{t("previewType")}</span>
              <span className="dl-stat-value">
                {t(KIND_KEY[kind])}
                {meta.contentType ? (
                  <span className="dl-stat-sub">{meta.contentType}</span>
                ) : null}
              </span>
            </div>
            <div className="dl-stat">
              <span className="dl-stat-label">{t("previewConnection")}</span>
              <span className="dl-stat-value">
                {meta.speed ? formatSpeed(meta.speed) : "—"}
              </span>
            </div>
            <div className="dl-stat">
              <span className="dl-stat-label">{t("previewTime")}</span>
              <span className="dl-stat-value">{eta ? eta : "—"}</span>
            </div>
          </div>

          {limited && (
            <div className="dl-preview-note">
              {t("cappedAt", { v: formatBytes(limitBytes!) })}
            </div>
          )}

          <div className="dl-preview-actions">
            <button className="btn btn-ghost" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button className="btn btn-primary" onClick={onConfirm} autoFocus>
              <ArrowDownIcon width={15} height={15} />
              {t("download")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
