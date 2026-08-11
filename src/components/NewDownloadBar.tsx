import { useEffect, useRef, useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { downloadDir } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrent } from "@tauri-apps/plugin-deep-link";
import { api } from "../lib/ipc";
import type { AppSettings } from "../types";
import { formatBytes, looksLikeUrl } from "../lib/format";
import { ArrowDownIcon, ClipboardIcon, FolderIcon, XIcon } from "../lib/icons";
import { useI18n, num } from "../lib/i18n";
import type { ClipboardHit } from "../hooks/useClipboard";

function joinPath(dir: string, name: string): string {
  const sep = navigator.userAgent.includes("Windows") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** Pull every http(s) URL out of a pasted blob of text (one per line). */
function detectUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of text.split(/\s+/)) {
    const u = token.trim();
    if (u && looksLikeUrl(u) && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

interface DeepLink {
  url: string;
  filename: string | null;
  referrer: string | null;
  cookies: string | null;
}

/**
 * Parse drift://add?url=<encoded>&filename=<encoded>&referrer=<encoded>&cookies=<encoded>.
 * The cookies param is forwarded by the browser extension for login-protected
 * downloads and sent with every request for that download.
 */
function parseDeepLink(raw: string): DeepLink | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "drift:") return null;
    const target = u.searchParams.get("url");
    if (!target || !looksLikeUrl(target)) return null;
    const filename = u.searchParams.get("filename");
    const referrer = u.searchParams.get("referrer");
    const cookies = u.searchParams.get("cookies");
    return {
      url: target,
      filename: filename && filename.trim() ? filename : null,
      referrer: referrer && referrer.trim() ? referrer : null,
      cookies: cookies && cookies.trim() ? cookies : null,
    };
  } catch {
    return null;
  }
}

export function NewDownloadBar({
  settings,
  mobile,
  existingUrls,
  hit,
  onHitHandled,
  onStart,
  notify,
}: {
  settings: AppSettings;
  mobile?: boolean;
  existingUrls: Set<string>;
  hit: ClipboardHit | null;
  onHitHandled: () => void;
  onStart: (
    url: string,
    path: string,
    speedLimit: number | null,
    referrer?: string | null,
    cookies?: string | null,
  ) => void;
  notify: (msg: string, kind: "success" | "error" | "info") => void;
}) {
  const t = useI18n();
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [limit, setLimit] = useState("");
  const [probing, setProbing] = useState(false);
  const [batch, setBatch] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const dir = settings.lastSaveDir ?? (await downloadDir());
        if (!disposed) setFolder(dir);
      } catch {
        if (!disposed) setFolder("");
      }
    })();
    return () => {
      disposed = true;
    };
  }, [settings.lastSaveDir]);

  const limitBytes = (): number | null => {
    const v = parseFloat(limit);
    if (!Number.isFinite(v) || v <= 0) return null;
    return Math.round(v * 1024 * 1024);
  };

  const changeFolder = async () => {
    // Native folder pickers aren't supported on Android/iOS — skip silently.
    if (mobile) return;
    try {
      const chosen = await open({
        directory: true,
        title: t("chooseFolderTitle"),
        defaultPath: folder || undefined,
      });
      if (typeof chosen === "string") setFolder(chosen);
    } catch {
      notify(t("folderPickerError"), "error");
    }
  };

  const startFlow = async (
    targetUrl: string,
    opts?: {
      filename?: string | null;
      referrer?: string | null;
      cookies?: string | null;
    },
  ) => {
    // Bare www. links (no scheme) get https:// added automatically.
    let clean = targetUrl.trim();
    if (!/^https?:\/\//i.test(clean) && /^www\./i.test(clean)) {
      clean = `https://${clean}`;
    }
    if (!looksLikeUrl(clean) || !clean.startsWith("http")) {
      notify(t("invalidUrl"), "error");
      return;
    }
    if (existingUrls.has(clean)) {
      notify(t("alreadyExists"), "info");
      return;
    }
    setProbing(true);
    try {
      // Send the referrer + cookies (from the browser extension handoff) so
      // the probe works for hotlink-protected and login-protected files.
      const meta = await api.probeUrl(clean, opts?.referrer ?? undefined, opts?.cookies ?? undefined);
      let chosen: string;
      // Prefer the hint from the browser when the probe only found a generic name.
      const probeName = meta.filename || "download";
      const name = opts?.filename && probeName === "download" ? opts.filename : probeName;
      // On mobile, or with auto-save on, there is no native save dialog: write
      // straight into the chosen/last folder with the server-provided name.
      if (mobile || settings.autoSave) {
        if (!folder) {
          notify(t("chooseFolderFirst"), "error");
          return;
        }
        chosen = joinPath(folder, name);
      } else {
        const baseDir = folder ?? "";
        const r = await save({
          title: t("saveAs"),
          defaultPath: joinPath(baseDir, name),
        });
        if (typeof r !== "string") return; // user cancelled
        chosen = r;
      }
      onStart(clean, chosen, limitBytes(), opts?.referrer ?? null, opts?.cookies ?? null);
      setUrl("");
      setLimit("");
      onHitHandled();
    } catch (e) {
      notify(t("startFailed", { err: String(e) }), "error");
    } finally {
      setProbing(false);
    }
  };

  const downloadAll = async (urls: string[]) => {
    for (const u of urls) {
      await startFlow(u);
    }
    setBatch(null);
    setUrl("");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void startFlow(url);
  };

  const onInputChange = (v: string) => {
    setUrl(v);
    const urls = detectUrls(v);
    setBatch(urls.length > 1 ? urls : null);
  };

  // Receive links handed off from the browser via drift://add?url=…
  const startFlowRef = useRef(startFlow);
  useEffect(() => {
    startFlowRef.current = startFlow;
  });
  // Mirror settings.autoSave so the deep-link listener (registered once) never
  // needs to re-run when settings change.
  const autoSaveRef = useRef(settings.autoSave);
  useEffect(() => {
    autoSaveRef.current = settings.autoSave;
  });

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    // Guard against duplicate deliveries of the same URL. On cold start the
    // launch URL can arrive both via getCurrent() and as a live event, and a
    // page can re-trigger a download after the browser copy is cancelled.
    // Without this, a single handoff could open several save dialogs at once.
    const recentHandoffs = new Map<string, number>();
    // URLs still being handed off (probing / waiting on the dialog). Blocks a
    // second delivery of the same URL while the first is still in flight — the
    // timestamp dedupe below only covers handoffs that already finished.
    const inFlight = new Set<string>();
    const handle = (raw: string) => {
      const u = parseDeepLink(raw);
      if (!u) return;
      const now = Date.now();
      const last = recentHandoffs.get(u.url) ?? 0;
      if (now - last < 8000 || inFlight.has(u.url)) return;
      recentHandoffs.set(u.url, now);
      if (recentHandoffs.size > 200) {
        for (const [k, v] of recentHandoffs) {
          if (now - v > 60000) recentHandoffs.delete(k);
        }
      }
      inFlight.add(u.url);
      // Silent handoff: with auto-save on there is no dialog to answer, so
      // don't yank focus away from the user's browser.
      if (!autoSaveRef.current) {
        try {
          void getCurrentWindow().show();
          void getCurrentWindow().setFocus();
        } catch {
          /* window API unavailable */
        }
      }
      void startFlowRef.current(u.url, {
        filename: u.filename,
        referrer: u.referrer,
        cookies: u.cookies,
      }).finally(() => {
        inFlight.delete(u.url);
      });
    };
    (async () => {
      try {
        unlisten = await listen<string>("drift://incoming", (e) => {
          if (!disposed) handle(e.payload);
        });
        // Cold start: the launch URL arrives before this listener is ready,
        // so pick it up explicitly once, then rely on live events.
        const initial = await getCurrent();
        if (initial && !disposed) {
          for (const u of initial) handle(u);
        }
      } catch {
        // running in a plain browser — no deep-link events
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="new-download">
      {hit && (
        <div className="clipboard-card">
          <span className="clipboard-icon">
            <ClipboardIcon width={16} height={16} />
          </span>
          <div className="clipboard-body">
            <span className="clipboard-title">{t("urlCopied")}</span>
            <span className="clipboard-url" title={hit.url}>
              {hit.url.length > 72 ? hit.url.slice(0, 72) + "…" : hit.url}
            </span>
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={probing}
            onClick={() => void startFlow(hit.url)}
          >
            <ArrowDownIcon width={14} height={14} />
            {t("download")}
          </button>
          <button className="icon-btn" onClick={onHitHandled} title={t("dismiss")}>
            <XIcon width={15} height={15} />
          </button>
        </div>
      )}

      {batch && (
        <div className="batch-card">
          <div className="batch-head">
            <span className="batch-title">{t("urlsDetected", { n: num(batch.length) })}</span>
            <button
              className="icon-btn"
              onClick={() => {
                setBatch(null);
                setUrl("");
              }}
              title={t("clearBatch")}
              aria-label={t("clearBatch")}
            >
              <XIcon width={15} height={15} />
            </button>
          </div>
          <div className="batch-list">
            {batch.slice(0, 6).map((u) => (
              <div className="batch-row" key={u}>
                <span className="batch-url" title={u}>
                  {u}
                </span>
                <button
                  className="icon-btn"
                  onClick={() =>
                    setBatch((b) => {
                      const next = b ? b.filter((x) => x !== u) : b;
                      return next && next.length > 1 ? next : null;
                    })
                  }
                  title={t("skipUrl")}
                  aria-label={t("skipUrl")}
                >
                  <XIcon width={13} height={13} />
                </button>
              </div>
            ))}
            {batch.length > 6 && (
              <span className="batch-more">{t("moreUrls", { n: num(batch.length - 6) })}</span>
            )}
          </div>
          <div className="batch-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={probing}
              onClick={() => void downloadAll(batch)}
            >
              <ArrowDownIcon width={14} height={14} />
              {probing ? t("adding") : t("downloadAll", { n: num(batch.length) })}
            </button>
          </div>
        </div>
      )}

      <form className="download-bar" onSubmit={onSubmit}>
        <div className="download-bar-main">
          <input
            id="url-input"
            ref={inputRef}
            className="url-input"
            value={url}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder={t("urlPlaceholder")}
            spellCheck={false}
            autoFocus
          />
          <input
            className="limit-input"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder={t("limitPlaceholder")}
            title={t("limitTitle")}
            aria-label={t("limitTitle")}
            inputMode="decimal"
          />
          <span className="limit-unit">MB/s</span>
          {!batch && (
            <button className="btn btn-primary" type="submit" disabled={probing}>
              {probing ? (
                <span className="spinner spinner-sm" />
              ) : (
                <ArrowDownIcon width={15} height={15} />
              )}
              {probing ? t("checking") : t("download")}
            </button>
          )}
        </div>
        <div className="download-bar-sub">
          {mobile ? (
            <span className="bar-hint">{t("savingToAppFolder")}</span>
          ) : (
            <button
              type="button"
              className="folder-chip"
              onClick={() => void changeFolder()}
              title={folder || t("chooseFolder")}
            >
              <FolderIcon width={14} height={14} />
              <span className="folder-path">
                {folder && folder.length > 52
                  ? "…" + folder.slice(folder.length - 52)
                  : folder || t("chooseFolder")}
              </span>
              <span className="folder-change">{t("change")}</span>
            </button>
          )}
          <span className="bar-hint">
            {limitBytes()
              ? t("cappedAt", { v: formatBytes(limitBytes()!) })
              : settings.autoSave
                ? t("autoSaving")
                : t("noLimit")}
          </span>
        </div>
      </form>
    </div>
  );
}
