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

/** Parse drift://add?url=<encoded> deep links. */
function parseDeepLink(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "drift:") return null;
    const target = u.searchParams.get("url");
    return target && looksLikeUrl(target) ? target : null;
  } catch {
    return null;
  }
}

export function NewDownloadBar({
  settings,
  existingUrls,
  hit,
  onHitHandled,
  onStart,
  notify,
}: {
  settings: AppSettings;
  existingUrls: Set<string>;
  hit: ClipboardHit | null;
  onHitHandled: () => void;
  onStart: (url: string, path: string, speedLimit: number | null) => void;
  notify: (msg: string, kind: "success" | "error" | "info") => void;
}) {
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
    try {
      const chosen = await open({
        directory: true,
        title: "Choose download folder",
        defaultPath: folder || undefined,
      });
      if (typeof chosen === "string") setFolder(chosen);
    } catch {
      notify("Could not open folder picker", "error");
    }
  };

  const startFlow = async (targetUrl: string) => {
    const clean = targetUrl.trim();
    if (!looksLikeUrl(clean) || !clean.startsWith("http")) {
      notify("Enter a valid http(s) URL", "error");
      return;
    }
    if (existingUrls.has(clean)) {
      notify("This URL is already in your downloads", "info");
      return;
    }
    setProbing(true);
    try {
      const meta = await api.probeUrl(clean);
      let chosen: string;
      if (settings.autoSave && folder) {
        // Auto-save: skip the dialog, let the backend pick a unique name.
        chosen = joinPath(folder, meta.filename || "download");
      } else {
        const baseDir = folder ?? "";
        const r = await save({
          title: "Save download as",
          defaultPath: joinPath(baseDir, meta.filename || "download"),
        });
        if (typeof r !== "string") return; // user cancelled
        chosen = r;
      }
      onStart(clean, chosen, limitBytes());
      setUrl("");
      setLimit("");
      onHitHandled();
    } catch (e) {
      notify(`Failed to start download: ${String(e)}`, "error");
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

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const handle = (raw: string) => {
      const u = parseDeepLink(raw);
      if (!u) return;
      try {
        void getCurrentWindow().show();
        void getCurrentWindow().setFocus();
      } catch {
        /* window API unavailable */
      }
      void startFlowRef.current(u);
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
            <span className="clipboard-title">URL copied to clipboard</span>
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
            Download
          </button>
          <button className="icon-btn" onClick={onHitHandled} title="Dismiss">
            <XIcon width={15} height={15} />
          </button>
        </div>
      )}

      {batch && (
        <div className="batch-card">
          <div className="batch-head">
            <span className="batch-title">
              {batch.length} URLs detected
            </span>
            <button
              className="icon-btn"
              onClick={() => {
                setBatch(null);
                setUrl("");
              }}
              title="Clear"
              aria-label="Clear batch"
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
                  title="Skip this URL"
                  aria-label="Skip this URL"
                >
                  <XIcon width={13} height={13} />
                </button>
              </div>
            ))}
            {batch.length > 6 && (
              <span className="batch-more">+{batch.length - 6} more…</span>
            )}
          </div>
          <div className="batch-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={probing}
              onClick={() => void downloadAll(batch)}
            >
              <ArrowDownIcon width={14} height={14} />
              {probing ? "Adding…" : `Download all (${batch.length})`}
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
            placeholder="Paste a link to download… (one per line for batch)"
            spellCheck={false}
            autoFocus
          />
          <input
            className="limit-input"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="Limit"
            title="Optional speed limit in MB/s"
            aria-label="Speed limit in MB/s"
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
              {probing ? "Checking…" : "Download"}
            </button>
          )}
        </div>
        <div className="download-bar-sub">
          <button
            type="button"
            className="folder-chip"
            onClick={() => void changeFolder()}
            title={folder || "Choose a folder"}
          >
            <FolderIcon width={14} height={14} />
            <span className="folder-path">
              {folder && folder.length > 52
                ? "…" + folder.slice(folder.length - 52)
                : folder || "Choose a folder"}
            </span>
            <span className="folder-change">Change</span>
          </button>
          <span className="bar-hint">
            {limitBytes()
              ? `Capped at ${formatBytes(limitBytes()!)}/s`
              : settings.autoSave
                ? "Auto-saving to folder"
                : "No speed limit"}
          </span>
        </div>
      </form>
    </div>
  );
}
