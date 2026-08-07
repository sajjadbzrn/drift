import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { api } from "./lib/ipc";
import type { DownloadInfo, Filter, Toast } from "./types";
import { formatSpeed, isActive } from "./lib/format";
import { I18nProvider, makeT, num, setActiveLang } from "./lib/i18n";
import { useDownloads } from "./hooks/useDownloads";
import { useSettings } from "./hooks/useSettings";
import { useClipboard } from "./hooks/useClipboard";
import { useUpdater } from "./hooks/useUpdater";
import { Titlebar } from "./components/Titlebar";
import { Sidebar } from "./components/Sidebar";
import { NewDownloadBar } from "./components/NewDownloadBar";
import { DownloadList } from "./components/DownloadList";
import { SettingsModal } from "./components/SettingsModal";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { ToastStack, pushToast, dismissToast } from "./components/Toasts";
import {
  BoltIcon,
  ChevronDownIcon,
  ChevronsUpIcon,
  ChevronUpIcon,
  CopyIcon,
  ExternalIcon,
  FolderIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
} from "./lib/icons";
import "./App.css";

function parentDir(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : "";
}

function useSystemDark() {
  const [dark, setDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

interface CtxState {
  x: number;
  y: number;
  d: DownloadInfo;
  index: number;
}

function App() {
  const downloads = useDownloads();
  const { settings, update, loaded: settingsLoaded } = useSettings();
  const systemDark = useSystemDark();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const clipboard = useClipboard(true);
  const peakRef = useRef(0);
  const updater = useUpdater();
  const autoCheckedRef = useRef(false);

  const t = useMemo(() => makeT(settings.language), [settings.language]);

  const resolvedTheme: "dark" | "light" =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  // Apply language: <html lang>, text direction, and number localization.
  useEffect(() => {
    const el = document.documentElement;
    el.lang = settings.language;
    el.dir = settings.language === "fa" ? "rtl" : "ltr";
    setActiveLang(settings.language);
  }, [settings.language]);

  const notify = useCallback(
    (msg: string, kind: Toast["kind"] = "info", action?: Toast["action"]) =>
      pushToast(setToasts, msg, kind, action),
    [],
  );

  // Ask for native notification permission once (Windows grants it silently).
  useEffect(() => {
    void (async () => {
      try {
        if (!(await isPermissionGranted())) {
          await requestPermission();
        }
      } catch {
        // not running inside Tauri — ignore
      }
    })();
  }, []);

  // Silent update check once settings have loaded (and only once per session).
  useEffect(() => {
    if (!settingsLoaded || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void (async () => {
      try {
        const info = await updater.check();
        if (info) {
          pushToast(setToasts, t("updateToast", { version: info.version }), "info", {
            label: t("updateNow"),
            onClick: () => void updater.startUpdate(),
          });
        }
      } catch {
        // silent — the check is best-effort
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  // Ctrl/Cmd+L focuses the URL bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        document.getElementById("url-input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(
    () => ({
      all: downloads.length,
      active: downloads.filter((d) => isActive(d.status)).length,
      completed: downloads.filter((d) => d.status === "completed").length,
      paused: downloads.filter((d) => d.status === "paused").length,
      failed: downloads.filter(
        (d) => d.status === "failed" || d.status === "cancelled",
      ).length,
    }),
    [downloads],
  );

  const totalSpeed = useMemo(
    () =>
      downloads
        .filter((d) => d.status === "downloading" || d.status === "retrying")
        .reduce((s, d) => s + d.speed, 0),
    [downloads],
  );
  if (totalSpeed > peakRef.current) peakRef.current = totalSpeed;

  const totalBytes = useMemo(
    () => downloads.reduce((s, d) => s + d.received, 0),
    [downloads],
  );

  // Queue order — must match the backend's reorder sort exactly.
  const sortedAll = useMemo(
    () =>
      [...downloads].sort(
        (a, b) => a.priority - b.priority || b.createdAt - a.createdAt,
      ),
    [downloads],
  );

  const filtered = useMemo(() => {
    let list = sortedAll;
    if (filter === "active")
      list = list.filter((d) => d.status === "queued" || d.status === "downloading" || d.status === "retrying");
    else if (filter === "completed") list = list.filter((d) => d.status === "completed");
    else if (filter === "paused") list = list.filter((d) => d.status === "paused");
    else if (filter === "failed")
      list = list.filter((d) => d.status === "failed" || d.status === "cancelled");
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter(
        (d) =>
          d.filename.toLowerCase().includes(q) || d.url.toLowerCase().includes(q),
      );
    return list;
  }, [sortedAll, filter, query]);

  const existingUrls = useMemo(
    () => new Set(downloads.map((d) => d.url)),
    [downloads],
  );

  const startDownload = useCallback(
    async (
      url: string,
      path: string,
      speedLimit: number | null,
      referrer?: string | null,
    ) => {
      try {
        const d = await api.startDownload(url, path, speedLimit, null, referrer);
        notify(t("downloadingToast", { name: d.filename }), "success");
        const dir = parentDir(path);
        if (dir && dir !== settings.lastSaveDir) update({ lastSaveDir: dir });
      } catch (e) {
        notify(t("couldNotStart", { err: String(e) }), "error");
      }
    },
    [notify, settings.lastSaveDir, t, update],
  );

  const runAction = useCallback(
    async (fn: () => Promise<unknown>, okMsg: string) => {
      try {
        await fn();
        if (okMsg) notify(okMsg, "success");
      } catch (e) {
        notify(String(e), "error");
      }
    },
    [notify],
  );

  const removeDownload = useCallback(
    async (d: DownloadInfo) => {
      const willDelete =
        settings.deleteWithRemove && d.status !== "downloading" && d.status !== "queued" && d.status !== "retrying";
      if (willDelete) {
        try {
          const ok = await confirm(t("deleteConfirm", { name: d.filename }), {
            title: t("removeTitle"),
            kind: "warning",
          });
          if (!ok) return;
        } catch {
          // dialog unavailable — proceed
        }
      }
      await runAction(() => api.remove(d.id), "");
    },
    [runAction, settings.deleteWithRemove, t],
  );

  const clearFinished = useCallback(async () => {
    const finished = downloads.filter((d) => d.status === "completed");
    if (finished.length === 0) return;
    const n = finished.length;
    try {
      const ok = await confirm(
        settings.deleteWithRemove
          ? t("clearFinishedDeleteConfirm", { n: num(n) })
          : t("clearFinishedListConfirm", { n: num(n) }),
        { title: t("clearFinishedTitle"), kind: "warning" },
      );
      if (!ok) return;
    } catch {
      // dialog unavailable — proceed
    }
    for (const d of finished) {
      try {
        await api.remove(d.id);
      } catch {
        /* ignore per-item errors */
      }
    }
    notify(t("clearedToast", { n: num(n) }), "success");
  }, [downloads, notify, settings.deleteWithRemove, t]);

  const onCopy = useCallback(
    async (d: DownloadInfo) => {
      try {
        await writeText(d.url);
        notify(t("linkCopied"), "info");
      } catch {
        notify(t("couldNotCopy"), "error");
      }
    },
    [notify, t],
  );

  const onOpenFile = useCallback(
    async (d: DownloadInfo) => {
      try {
        await openPath(d.path);
      } catch {
        notify(t("couldNotOpenFile"), "error");
      }
    },
    [notify, t],
  );

  const onOpenFolder = useCallback(
    async (d: DownloadInfo) => {
      try {
        await revealItemInDir(d.status === "completed" ? d.path : d.dir);
      } catch {
        notify(t("couldNotOpenFolder"), "error");
      }
    },
    [notify, t],
  );

  const onCardContext = useCallback(
    (d: DownloadInfo, e: React.MouseEvent) => {
      e.preventDefault();
      const index = sortedAll.findIndex((x) => x.id === d.id);
      setCtx({ x: e.clientX, y: e.clientY, d, index });
    },
    [sortedAll],
  );

  const closeCtx = useCallback(() => setCtx(null), []);

  const ctxItems = useMemo<MenuItem[]>(() => {
    if (!ctx) return [];
    const d = ctx.d;
    const items: MenuItem[] = [];
    const idx = ctx.index;
    const last = downloads.length - 1;
    // Queue controls — reorder within the full (priority-sorted) queue.
    if (idx > 0) {
      items.push({
        label: t("moveUp"),
        icon: <ChevronUpIcon width={14} height={14} />,
        onClick: () => void runAction(() => api.reorder(d.id, idx - 1), ""),
      });
    }
    if (idx < last) {
      items.push({
        label: t("moveDown"),
        icon: <ChevronDownIcon width={14} height={14} />,
        onClick: () => void runAction(() => api.reorder(d.id, idx + 1), ""),
      });
    }
    if (idx > 0 && (d.status === "queued" || d.status === "paused")) {
      items.push({
        label: t("startNow"),
        icon: <ChevronsUpIcon width={14} height={14} />,
        onClick: () =>
          void runAction(async () => {
            await api.reorder(d.id, 0);
            if (d.status === "paused") await api.resume(d.id);
          }, ""),
      });
    }
    if (items.length > 0) items.push({ separator: true });
    if (d.status === "downloading" || d.status === "retrying") {
      items.push({ label: t("pause"), icon: <PauseIcon width={14} height={14} />, onClick: () => void runAction(() => api.pause(d.id), "") });
      items.push({ label: t("cancel"), danger: true, icon: <TrashIcon width={14} height={14} />, onClick: () => void runAction(() => api.cancel(d.id), "") });
    } else if (d.status === "paused") {
      items.push({ label: t("resume"), icon: <PlayIcon width={14} height={14} />, onClick: () => void runAction(() => api.resume(d.id), "") });
      items.push({ label: t("cancel"), danger: true, icon: <TrashIcon width={14} height={14} />, onClick: () => void runAction(() => api.cancel(d.id), "") });
    } else if (d.status === "failed" || d.status === "cancelled") {
      items.push({ label: t("tryAgain"), icon: <RefreshIcon width={14} height={14} />, onClick: () => void runAction(() => api.retry(d.id), "") });
    }
    if (d.status === "completed") {
      items.push({ label: t("openFile"), icon: <ExternalIcon width={14} height={14} />, onClick: () => void onOpenFile(d) });
    }
    items.push({ label: t("showInFolder"), icon: <FolderIcon width={14} height={14} />, onClick: () => void onOpenFolder(d) });
    items.push({ label: t("copyLink"), icon: <CopyIcon width={14} height={14} />, onClick: () => void onCopy(d) });
    items.push({ separator: true });
    items.push({ label: t("remove"), danger: true, icon: <TrashIcon width={14} height={14} />, onClick: () => void removeDownload(d) });
    return items;
  }, [ctx, downloads.length, runAction, onOpenFile, onOpenFolder, onCopy, removeDownload, t]);

  return (
    <I18nProvider lang={settings.language}>
      <div className="app">
        <Titlebar />
        <div className="app-body">
          <Sidebar
            filter={filter}
            onFilter={setFilter}
            counts={counts}
            totalSpeed={totalSpeed}
            peakSpeed={peakRef.current}
            totalBytes={totalBytes}
            activeCount={counts.active}
            theme={resolvedTheme}
            onToggleTheme={() =>
              update({ theme: resolvedTheme === "dark" ? "light" : "dark" })
            }
            onOpenSettings={() => setSettingsOpen(true)}
            onPauseAll={() => void runAction(() => api.pauseAll(), "")}
            onResumeAll={() => void runAction(() => api.resumeAll(), "")}
          />

          <main className="main">
            <div className="main-inner">
              <header className="page-head">
                <div className="page-title">
                  <h1>{t("downloadsTitle")}</h1>
                  <span className="page-count">
                    {t("items", { n: num(counts.all) })}
                  </span>
                  {totalSpeed > 0 && (
                    <span className="speed-pill">
                      <BoltIcon width={13} height={13} />
                      {formatSpeed(totalSpeed)}
                    </span>
                  )}
                </div>
                <div className="page-actions">
                  {counts.completed > 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => void clearFinished()}>
                      {t("clearFinished")}
                    </button>
                  )}
                  <div className="search-wrap">
                    <SearchIcon width={15} height={15} />
                    <input
                      className="search-input"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("searchPlaceholder")}
                      spellCheck={false}
                    />
                  </div>
                </div>
              </header>

              <NewDownloadBar
                settings={settings}
                existingUrls={existingUrls}
                hit={clipboard.hit}
                onHitHandled={clipboard.clear}
                onStart={startDownload}
                notify={notify}
              />

              <DownloadList
                downloads={filtered}
                filter={filter}
                onContext={onCardContext}
                onPause={(id) => void runAction(() => api.pause(id), "")}
                onResume={(id) => void runAction(() => api.resume(id), "")}
                onRetry={(id) => void runAction(() => api.retry(id), "")}
                onCancel={(id) => void runAction(() => api.cancel(id), "")}
                onRemove={removeDownload}
                onOpenFile={onOpenFile}
                onOpenFolder={onOpenFolder}
                onCopy={onCopy}
              />
            </div>
          </main>
        </div>

        {ctx && (
          <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={closeCtx} />
        )}

        <SettingsModal
          open={settingsOpen}
          settings={settings}
          update={update}
          onClose={() => setSettingsOpen(false)}
          updaterState={updater.state}
          onCheckUpdates={() => void updater.check()}
          onUpdateNow={() => void updater.startUpdate()}
        />
        <ToastStack toasts={toasts} onDismiss={(id) => dismissToast(setToasts, id)} />
      </div>
    </I18nProvider>
  );
}

export default App;
