import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { downloadDir } from "@tauri-apps/api/path";
import { api } from "../lib/ipc";
import { looksLikeUrl } from "../lib/format";
import { XIcon, ArrowDownIcon, FolderIcon } from "../lib/icons";
import { useI18n, num } from "../lib/i18n";
import type { AppSettings } from "../types";

function joinPath(dir: string, name: string): string {
  const sep = navigator.userAgent.includes("Windows") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

function parseUrls(text: string): string[] {
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

export function BatchImportModal({
  settings,
  notify,
  onClose,
}: {
  settings: AppSettings;
  notify: (msg: string, kind: "success" | "error" | "info") => void;
  onClose: () => void;
}) {
  const t = useI18n();
  const [text, setText] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const changeFolder = async () => {
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

  const urls = parseUrls(text);
  const importAll = async () => {
    if (!folder || urls.length === 0) return;
    setImporting(true);
    setDone(0);
    let ok = 0;
    for (const raw of urls) {
      let clean = raw.trim();
      if (!/^https?:\/\//i.test(clean) && /^www\./i.test(clean)) {
        clean = `https://${clean}`;
      }
      try {
        const meta = await api.probeUrl(clean);
        const name = meta.filename || "download";
        const path = joinPath(folder, name);
        await api.startDownload(clean, path, null, null);
        ok += 1;
      } catch {
        // skip a single bad URL and keep going
      }
      setDone((d) => d + 1);
    }
    setImporting(false);
    notify(
      ok === urls.length
        ? t("batchDone", { n: num(ok) })
        : t("batchPartial", { ok: num(ok), total: num(urls.length) }),
      ok === urls.length ? "success" : "info",
    );
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-left">
            <img className="modal-brand" src="/drift.png" alt="drift" draggable={false} />
            <span className="modal-title">{t("batchImport")}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}>
            <XIcon width={16} height={16} />
          </button>
        </div>
        <div className="modal-body">
          <p className="batch-help">{t("batchHelp")}</p>
          <textarea
            ref={inputRef}
            className="batch-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("batchPlaceholder")}
            spellCheck={false}
            rows={10}
          />
          <div className="download-bar-sub">
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
            <span className="bar-hint">
              {urls.length > 0 ? t("urlsDetected", { n: num(urls.length) }) : t("batchEmptyHint")}
            </span>
          </div>
          <div className="batch-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={importing || urls.length === 0 || !folder}
              onClick={() => void importAll()}
            >
              {importing ? (
                <>
                  <span className="spinner spinner-sm" />
                  {t("importing", { n: num(done), total: num(urls.length) })}
                </>
              ) : (
                <>
                  <ArrowDownIcon width={14} height={14} />
                  {t("importAll", { n: num(urls.length) })}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
