import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { AppSettings, Theme } from "../types";
import { formatBytes } from "../lib/format";
import { XIcon } from "../lib/icons";

const LICENSE_URL = "/license.txt";

function Toggle({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      className="setting-row"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        <span className="setting-desc">{desc}</span>
      </span>
      <span className={`switch${checked ? " switch-on" : ""}`}>
        <span className="switch-knob" />
      </span>
    </button>
  );
}

function NumberField({
  label,
  desc,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  desc: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        <span className="setting-desc">{desc}</span>
      </span>
      <span className="number-field">
        <input
          type="number"
          min={min}
          max={max}
          step={unit === "MB/s" ? 0.5 : 1}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
            else if (e.target.value === "") onChange(0);
          }}
        />
        <span className="number-unit">{unit}</span>
      </span>
    </div>
  );
}

export function SettingsModal({
  open,
  settings,
  update,
  onClose,
}: {
  open: boolean;
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
}) {
  const [version, setVersion] = useState("0.1.0");
  const [license, setLicense] = useState<string | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    getVersion()
      .then((v) => setVersion(v))
      .catch(() => {
        /* not running inside Tauri */
      });
  }, [open]);

  const toggleLicense = () => {
    const next = !licenseOpen;
    setLicenseOpen(next);
    if (next && license === null) {
      fetch(LICENSE_URL)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(setLicense)
        .catch(() => setLicense("The license text could not be loaded."));
    }
  };

  if (!open) return null;
  const themes: { id: Theme; label: string }[] = [
    { id: "system", label: "System" },
    { id: "dark", label: "Dark" },
    { id: "light", label: "Light" },
  ];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Settings</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="modal-body">
          <section>
            <span className="section-label">Appearance</span>
            <div className="segmented">
              {themes.map((t) => (
                <button
                  key={t.id}
                  className={`seg-btn${settings.theme === t.id ? " seg-btn-on" : ""}`}
                  onClick={() => update({ theme: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <span className="section-label">Speed</span>
            <NumberField
              label="Global speed limit"
              desc="Total bandwidth cap across all downloads. 0 = unlimited."
              value={settings.globalSpeedLimit / (1024 * 1024)}
              unit="MB/s"
              min={0}
              max={100}
              onChange={(v) =>
                update({ globalSpeedLimit: Math.round(v * 1024 * 1024) })
              }
            />
            <NumberField
              label="Default per-download limit"
              desc="Speed cap applied to new downloads. 0 = unlimited."
              value={settings.defaultSpeedLimit / (1024 * 1024)}
              unit="MB/s"
              min={0}
              max={100}
              onChange={(v) =>
                update({ defaultSpeedLimit: Math.round(v * 1024 * 1024) })
              }
            />
            <NumberField
              label="Max concurrent downloads"
              desc="How many files download at the same time."
              value={settings.maxConcurrent}
              unit="files"
              min={1}
              max={8}
              onChange={(v) => update({ maxConcurrent: Math.round(v) })}
            />
          </section>

          <section>
            <span className="section-label">Downloading</span>
            <Toggle
              checked={settings.segmented}
              onChange={(v) => update({ segmented: v })}
              label="Segmented downloads"
              desc={`Split large files into parallel connections (files > ${formatBytes(16 * 1024 * 1024)}).`}
            />
            <Toggle
              checked={settings.autoRetry}
              onChange={(v) => update({ autoRetry: v })}
              label="Auto-retry failures"
              desc="Automatically retry transient errors with backoff."
            />
            {settings.autoRetry && (
              <NumberField
                label="Max retries"
                desc="How many times to retry before giving up."
                value={settings.maxRetries}
                unit="×"
                min={1}
                max={10}
                onChange={(v) => update({ maxRetries: Math.round(v) })}
              />
            )}
          </section>

          <section>
            <span className="section-label">Cleanup</span>
            <Toggle
              checked={settings.deleteWithRemove}
              onChange={(v) => update({ deleteWithRemove: v })}
              label="Delete file when removing"
              desc="Permanently delete the downloaded file (and partial data) when you remove an item."
            />
          </section>

          <section>
            <span className="section-label">About</span>
            <div className="about-card">
              <img
                className="about-logo"
                src="/drift.png"
                alt="drift"
                draggable={false}
              />
              <div className="about-info">
                <span className="about-name">drift</span>
                <span className="about-version">v{version}</span>
                <span className="about-sub">Fast, modern download manager</span>
              </div>
            </div>
            <div className="about-meta">
              <span>© 2026 Sajjad Bzn</span>
              <span>All rights reserved</span>
            </div>
            <button
              type="button"
              className="license-toggle"
              onClick={toggleLicense}
              aria-expanded={licenseOpen}
            >
              <span>End User License Agreement</span>
              <span className={`license-chevron${licenseOpen ? " license-chevron-open" : ""}`}>
                ▾
              </span>
            </button>
            {licenseOpen && (
              <div className="license-box">{license ?? "Loading license…"}</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
