import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { AppSettings, NativeHostStatus, Theme } from "../types";
import { formatBytes } from "../lib/format";
import { api } from "../lib/ipc";
import { XIcon } from "../lib/icons";
import { useI18n, num } from "../lib/i18n";
import type { UpdaterPhase } from "../hooks/useUpdater";

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
  updaterState,
  onCheckUpdates,
  onUpdateNow,
}: {
  open: boolean;
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  updaterState: UpdaterPhase;
  onCheckUpdates: () => void;
  onUpdateNow: () => void;
}) {
  const t = useI18n();
  const [version, setVersion] = useState("0.1.0");
  const [license, setLicense] = useState<string | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [hostStatus, setHostStatus] = useState<NativeHostStatus | null>(null);
  const [extIdsText, setExtIdsText] = useState("");
  const [uaText, setUaText] = useState("");

  useEffect(() => {
    if (!open) return;
    getVersion()
      .then((v) => setVersion(v))
      .catch(() => {
        /* not running inside Tauri */
      });
    setExtIdsText(settings.chromeExtIds.join(", "));
    setUaText(settings.userAgent);
    api
      .getNativeHostStatus()
      .then(setHostStatus)
      .catch(() => setHostStatus(null));
  }, [open]);

  const saveExtIds = () => {
    const ids = extIdsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    update({ chromeExtIds: ids });
    // Re-read the host status once the backend has re-registered the manifest.
    window.setTimeout(() => {
      api
        .getNativeHostStatus()
        .then(setHostStatus)
        .catch(() => {});
    }, 400);
  };

  const toggleLicense = () => {
    const next = !licenseOpen;
    setLicenseOpen(next);
    if (next && license === null) {
      fetch(LICENSE_URL)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(setLicense)
        .catch(() => setLicense(t("licenseError")));
    }
  };

  if (!open) return null;
  const themes: { id: Theme; label: string }[] = [
    { id: "system", label: t("themeSystem") },
    { id: "dark", label: t("themeDark") },
    { id: "light", label: t("themeLight") },
  ];
  const languages = [
    { id: "en" as const, label: "English" },
    { id: "fa" as const, label: "فارسی" },
  ];
  const up = updaterState;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-left">
            <img className="modal-brand" src="/drift.png" alt="drift" draggable={false} />
            <span className="modal-title">{t("settingsTitle")}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="modal-body">
          <section>
            <span className="section-label">{t("appearance")}</span>
            <div className="segmented">
              {themes.map((th) => (
                <button
                  key={th.id}
                  className={`seg-btn${settings.theme === th.id ? " seg-btn-on" : ""}`}
                  onClick={() => update({ theme: th.id })}
                >
                  {th.label}
                </button>
              ))}
            </div>
            <div className="setting-row">
              <span className="setting-text">
                <span className="setting-label">{t("language")}</span>
                <span className="setting-desc">{t("languageDesc")}</span>
              </span>
              <div className="segmented segmented-inline">
                {languages.map((l) => (
                  <button
                    key={l.id}
                    className={`seg-btn${settings.language === l.id ? " seg-btn-on" : ""}`}
                    onClick={() => update({ language: l.id })}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section>
            <span className="section-label">{t("updates")}</span>
            <div className="update-card">
              <div className="update-row">
                <span className="update-label">
                  {t("currentVersion")}
                </span>
                <span className="update-version">v{version}</span>
              </div>
              {up.phase === "idle" && (
                <button className="btn btn-primary btn-sm" onClick={onCheckUpdates}>
                  {t("checkForUpdates")}
                </button>
              )}
              {up.phase === "checking" && (
                <span className="update-status">
                  <span className="spinner spinner-sm" />
                  {t("checkingForUpdates")}
                </span>
              )}
              {up.phase === "up-to-date" && (
                <div className="update-row">
                  <span className="update-status update-ok">{t("upToDate")}</span>
                  <button className="btn-ghost btn-sm" onClick={onCheckUpdates}>
                    {t("checkForUpdates")}
                  </button>
                </div>
              )}
              {up.phase === "available" && (
                <div className="update-available">
                  <span className="update-status">
                    {t("updateAvailable", { version: up.info.version })}
                  </span>
                  {up.info.body && (
                    <span className="update-notes">
                      <span className="update-notes-label">{t("releaseNotes")}</span>
                      <span className="update-notes-text">{up.info.body}</span>
                    </span>
                  )}
                  <button className="btn btn-primary btn-sm" onClick={onUpdateNow}>
                    {t("updateNow")}
                  </button>
                </div>
              )}
              {up.phase === "downloading" && (
                <div className="update-download">
                  <span className="update-status">
                    {t("downloadingUpdate", {
                      pct: num(
                        up.total
                          ? Math.min(100, Math.round((up.received / up.total) * 100))
                          : 0,
                      ),
                    })}
                  </span>
                  <div className="card-bar">
                    <div
                      className="card-bar-fill"
                      style={{
                        width: up.total
                          ? `${Math.min(100, (up.received / up.total) * 100)}%`
                          : "40%",
                      }}
                    />
                  </div>
                </div>
              )}
              {up.phase === "installing" && (
                <span className="update-status">{t("installing")}</span>
              )}
              {up.phase === "error" && (
                <div className="update-error">
                  <span className="update-status update-error-text">
                    {t("updateFailed", { err: up.message })}
                  </span>
                  <button className="btn-ghost btn-sm" onClick={onCheckUpdates}>
                    {t("checkForUpdates")}
                  </button>
                </div>
              )}
            </div>
          </section>

          <section>
            <span className="section-label">{t("speed")}</span>
            <NumberField
              label={t("globalLimit")}
              desc={t("globalLimitDesc")}
              value={settings.globalSpeedLimit / (1024 * 1024)}
              unit="MB/s"
              min={0}
              max={100}
              onChange={(v) =>
                update({ globalSpeedLimit: Math.round(v * 1024 * 1024) })
              }
            />
            <NumberField
              label={t("defaultLimit")}
              desc={t("defaultLimitDesc")}
              value={settings.defaultSpeedLimit / (1024 * 1024)}
              unit="MB/s"
              min={0}
              max={100}
              onChange={(v) =>
                update({ defaultSpeedLimit: Math.round(v * 1024 * 1024) })
              }
            />
            <NumberField
              label={t("maxConcurrent")}
              desc={t("maxConcurrentDesc")}
              value={settings.maxConcurrent}
              unit={t("filesUnit")}
              min={1}
              max={8}
              onChange={(v) => update({ maxConcurrent: Math.round(v) })}
            />
          </section>

          <section>
            <span className="section-label">{t("network")}</span>
            <div className="setting-row">
              <span className="setting-text">
                <span className="setting-label">{t("userAgent")}</span>
                <span className="setting-desc">{t("userAgentDesc")}</span>
              </span>
            </div>
            <div className="ext-ids-row">
              <input
                className="ext-ids-input"
                value={uaText}
                onChange={(e) => setUaText(e.target.value)}
                placeholder={t("userAgentPlaceholder")}
                spellCheck={false}
                aria-label={t("userAgent")}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => update({ userAgent: "" })}
                disabled={!settings.userAgent}
                title={t("uaReset")}
              >
                {t("uaReset")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => update({ userAgent: uaText.trim() })}>
                {t("save")}
              </button>
            </div>
          </section>

          <section>
            <span className="section-label">{t("downloadingSection")}</span>
            <Toggle
              checked={settings.segmented}
              onChange={(v) => update({ segmented: v })}
              label={t("segmented")}
              desc={t("segmentedDesc", { size: formatBytes(16 * 1024 * 1024) })}
            />
            <Toggle
              checked={settings.autoRetry}
              onChange={(v) => update({ autoRetry: v })}
              label={t("autoRetry")}
              desc={t("autoRetryDesc")}
            />
            {settings.autoRetry && (
              <NumberField
                label={t("maxRetries")}
                desc={t("maxRetriesDesc")}
                value={settings.maxRetries}
                unit="×"
                min={1}
                max={10}
                onChange={(v) => update({ maxRetries: Math.round(v) })}
              />
            )}
          </section>

          <section>
            <span className="section-label">{t("saving")}</span>
            <Toggle
              checked={settings.autoSave}
              onChange={(v) => update({ autoSave: v })}
              label={t("autoSave")}
              desc={t("autoSaveDesc")}
            />
          </section>

          <section>
            <span className="section-label">{t("browserIntegration")}</span>
            <div className="setting-row">
              <span className="setting-text">
                <span className="setting-label">{t("extensionHost")}</span>
                <span className="setting-desc">{t("extensionHostDesc")}</span>
              </span>
              <span
                className={`host-status${hostStatus?.registered ? " host-status-ok" : " host-status-off"}`}
                title={hostStatus?.hostPath ?? undefined}
              >
                {hostStatus
                  ? hostStatus.registered
                    ? t("hostRegistered")
                    : t("hostNotRegistered")
                  : "…"}
              </span>
            </div>
            <div className="setting-row">
              <span className="setting-text">
                <span className="setting-label">{t("chromeExtIds")}</span>
                <span className="setting-desc">{t("chromeExtIdsDesc")}</span>
              </span>
            </div>
            <div className="ext-ids-row">
              <input
                className="ext-ids-input"
                value={extIdsText}
                onChange={(e) => setExtIdsText(e.target.value)}
                placeholder="abcdefghijklmnopabcdefghijklmnop"
                spellCheck={false}
                aria-label={t("chromeExtIds")}
              />
              <button className="btn btn-primary btn-sm" onClick={saveExtIds}>
                {t("save")}
              </button>
            </div>
          </section>

          <section>
            <span className="section-label">{t("systemSection")}</span>
            <Toggle
              checked={settings.closeToTray}
              onChange={(v) => update({ closeToTray: v })}
              label={t("closeToTray")}
              desc={t("closeToTrayDesc")}
            />
          </section>

          <section>
            <span className="section-label">{t("cleanup")}</span>
            <Toggle
              checked={settings.deleteWithRemove}
              onChange={(v) => update({ deleteWithRemove: v })}
              label={t("deleteWithRemove")}
              desc={t("deleteWithRemoveDesc")}
            />
          </section>

          <section>
            <span className="section-label">{t("about")}</span>
            <div className="about-card">
              <img
                className="about-logo"
                src="/drift.png"
                alt="drift"
                draggable={false}
              />
              <div className="about-info">
                <span className="about-name">{t("appName")}</span>
                <span className="about-version">v{version}</span>
                <span className="about-sub">{t("aboutSub")}</span>
              </div>
            </div>
            <div className="about-meta">
              <span>© 2026 Sajjad Bzn</span>
              <span>{t("allRights")}</span>
            </div>
            <button
              type="button"
              className="license-toggle"
              onClick={toggleLicense}
              aria-expanded={licenseOpen}
            >
              <span>{t("eula")}</span>
              <span className={`license-chevron${licenseOpen ? " license-chevron-open" : ""}`}>
                ▾
              </span>
            </button>
            {licenseOpen && (
              <div className="license-box">{license ?? t("licenseLoading")}</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
