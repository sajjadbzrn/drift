import { useEffect, useRef } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { DownloadInfo } from "../types";
import { formatBytes, formatSpeed, formatEta, formatDate, fileKindOf, KIND_COLOR } from "../lib/format";
import { useI18n, num } from "../lib/i18n";
import { XIcon, CopyIcon, CheckCircleIcon } from "../lib/icons";
import { animateDrawer } from "../lib/anim";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children}</span>
    </div>
  );
}

/** Per-segment lane list for segmented downloads. */
function Segments({ d }: { d: DownloadInfo }) {
  const t = useI18n();
  if (!d.segmented || d.segments.length === 0) return null;
  return (
    <div className="detail-segments">
      <span className="detail-label">{t("segments")}</span>
      <div className="segment-lanes">
        {d.segments.map((s) => {
          const expected = s.end - s.start + 1;
          const pct = expected > 0 ? Math.min(100, (s.received / expected) * 100) : 0;
          return (
            <div className="segment-lane" key={s.index} title={`#${num(s.index + 1)} — ${formatBytes(s.received)} / ${formatBytes(expected)}`}>
              <span className="segment-lane-num">{num(s.index + 1)}</span>
              <div className="segment-lane-track">
                <div className="segment-lane-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DetailsDrawer({
  d,
  onClose,
  onCopy,
}: {
  d: DownloadInfo | null;
  onClose: () => void;
  onCopy: (d: DownloadInfo) => void;
}) {
  const t = useI18n();
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!d || !backdropRef.current || !panelRef.current) return;
    return animateDrawer(panelRef.current);
  }, [d]);

  if (!d) return null;
  const kind = fileKindOf(d.filename);
  const color = KIND_COLOR[kind];
  const percent = d.totalSize ? Math.min(100, (d.received / d.totalSize) * 100) : null;
  const remaining = d.totalSize ? Math.max(0, d.totalSize - d.received) : null;

  return (
    <div className="drawer-overlay" ref={backdropRef} onClick={onClose}>
      <div
        className="drawer"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        style={{ "--kind": color } as React.CSSProperties}
      >
        <div className="drawer-head">
          <span className="drawer-title" title={d.filename}>{d.filename}</span>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            <XIcon width={16} height={16} />
          </button>
        </div>
        <div className="drawer-body">
          <Row label={t("detailStatus")}>
            <span className={`badge badge-${d.status}`}>
              {t(
                d.status === "completed"
                  ? "badgeDone"
                  : d.status === "downloading"
                    ? "badgeDownloading"
                    : d.status === "paused"
                      ? "badgePaused"
                      : d.status === "failed"
                        ? "badgeFailed"
                        : d.status === "cancelled"
                          ? "badgeCancelled"
                          : d.status === "retrying"
                            ? "badgeRetrying"
                            : "badgeQueued",
                d.status === "retrying" ? { n: num(d.retries) } : undefined,
              )}
            </span>
          </Row>
          {percent !== null && (
            <Row label={t("detailProgress")}>
              {num(Math.floor(percent))}% · {formatBytes(d.received)} {t("of")} {formatBytes(d.totalSize!)}
              {d.status === "downloading" && (
                <span className="detail-dim"> · {formatSpeed(d.speed)} · {t("left", { v: formatEta(remaining ?? 0, d.speed) })}</span>
              )}
            </Row>
          )}
          <Row label={t("detailUrl")}>
            <span className="detail-url" title={d.url}>{d.url}</span>
            <button
              className="icon-btn"
              title={t("copyLink")}
              onClick={() => void writeText(d.url).catch(() => {})}
            >
              <CopyIcon width={13} height={13} />
            </button>
          </Row>
          {d.referrer && (
            <Row label={t("detailReferrer")}>
              <span className="detail-url" title={d.referrer}>{d.referrer}</span>
            </Row>
          )}
          <Row label={t("detailFolder")}>{d.dir}</Row>
          <Row label={t("detailSavedAt")}>{formatDate(d.createdAt)}</Row>
          {d.completedAt && <Row label={t("detailCompletedAt")}>{formatDate(d.completedAt)}</Row>}
          {d.hash && (
            <Row label={t("hash")}>
              <span className="detail-hash">
                {d.verified ? (
                  <CheckCircleIcon width={13} height={13} />
                ) : (
                  <XIcon width={13} height={13} />
                )}
                <span title={d.hash}>{d.hash.slice(0, 16)}…</span>
              </span>
            </Row>
          )}
          {d.proxy && <Row label={t("proxy")}>{d.proxy}</Row>}
          {d.retries > 0 && <Row label={t("maxRetries")}>{num(d.retries)}</Row>}
          <Segments d={d} />
          {d.error && <div className="detail-error">{d.error}</div>}
          <div className="drawer-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => onCopy(d)}>
              <CopyIcon width={14} height={14} />
              {t("copyLink")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
