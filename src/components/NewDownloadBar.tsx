import { useEffect, useRef, useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { downloadDir } from "@tauri-apps/api/path";
import { api } from "../lib/ipc";
import type { AppSettings } from "../types";
import { formatBytes, looksLikeUrl } from "../lib/format";
import { ArrowDownIcon, ClipboardIcon, FolderIcon, XIcon } from "../lib/icons";
import type { ClipboardHit } from "../hooks/useClipboard";

function joinPath(dir: string, name: string): string {
  const sep = navigator.userAgent.includes("Windows") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
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
      const baseDir = folder ?? "";
      const defaultPath = joinPath(baseDir, meta.filename || "download");
      const chosen = await save({
        title: "Save download as",
        defaultPath,
      });
      if (typeof chosen !== "string") return; // user cancelled
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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void startFlow(url);
  };

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

      <form className="download-bar" onSubmit={onSubmit}>
        <div className="download-bar-main">
          <input
            id="url-input"
            ref={inputRef}
            className="url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a link to download…"
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
          <button className="btn btn-primary" type="submit" disabled={probing}>
            {probing ? (
              <span className="spinner spinner-sm" />
            ) : (
              <ArrowDownIcon width={15} height={15} />
            )}
            {probing ? "Checking…" : "Download"}
          </button>
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
              : "No speed limit"}
          </span>
        </div>
      </form>
    </div>
  );
}
