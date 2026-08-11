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
import { SpeedLimitModal } from "./components/SpeedLimitModal";
import { ParticleField } from "./components/ParticleField";
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
  XIcon,
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [limitTarget, setLimitTarget] = useState<DownloadInfo | null>(null);
  const clipboard = useClipboard(true);
  const [peakSpeed, setPeakSpeed] = useState(0);
  const updater = useUpdater();
  const autoCheckedRef = useRef(false);
  /** Prevent rapid successive folder-open calls that can crash Explorer. */
  const folderOpenGate = useRef(0);
  /** Downloads pending removal — show undo toast, delete after 6s. */
  const pendingRemove = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [pendingRemoveIds, setPendingRemoveIds] = useState<Set<string>>(new Set());

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

  // Refs for callbacks used inside the keyboard handler (defined later).
  const kRefs = useRef<{
    sortedAll: DownloadInfo[];
    runAction: (fn: () => Promise<unknown>, okMsg: string) => void;
    closeCtx: () => void;
    removeDownload: (d: DownloadInfo) => void;
    onOpenFile: (d: DownloadInfo) => void;
    onOpenFolder: (d: DownloadInfo) => void;
    ctx: CtxState | null;
  }>({
    sortedAll: [],
    runAction: () => {},
    closeCtx: () => {},
    removeDownload: () => {},
    onOpenFile: () => {},
    onOpenFolder: () => {},
    ctx: null,
  });

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        document.getElementById("url-input")?.focus();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search-input")?.focus();
        return;
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (e.key === "Escape") {
        if (kRefs.current.ctx) { kRefs.current.closeCtx(); return; }
        setSelectedIds(new Set());
        return;
      }

      if (isInput) return;

      const list = kRefs.current.sortedAll;
      // The "anchor" is the most recently selected card — arrow keys move it,
      // Space toggles it in/out of the selection.
      const anchor = selectedIds.size > 0 ? [...selectedIds][selectedIds.size - 1] : null;
      const idx = anchor ? list.findIndex((d) => d.id === anchor) : -1;
      const sel = idx >= 0 ? list[idx] : null;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.length === 0) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        let next = idx === -1 ? (delta > 0 ? 0 : list.length - 1) : idx + delta;
        if (next < 0) next = list.length - 1;
        if (next >= list.length) next = 0;
        setSelectedIds(new Set([list[next].id]));
        return;
      }

      if (sel) {
        if (e.key === " ") {
          e.preventDefault();
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(sel.id)) next.delete(sel.id);
            else next.add(sel.id);
            return next;
          });
          return;
        }
        if (e.key === "Delete") {
          e.preventDefault();
          const targets =
            selectedIds.size > 1
              ? (list.filter((d) => selectedIds.has(d.id)) as DownloadInfo[])
              : [sel];
          for (const d of targets) kRefs.current.removeDownload(d);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (sel.status === "completed") kRefs.current.onOpenFile(sel);
          else kRefs.current.onOpenFolder(sel);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds]);

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

  // Keep the tray tooltip in sync with active download count.
  useEffect(() => {
    void api.updateTrayTooltip(counts.active).catch(() => {});
  }, [counts.active]);

  const totalSpeed = useMemo(
    () =>
      downloads
        .filter((d) => d.status === "downloading" || d.status === "retrying")
        .reduce((s, d) => s + d.speed, 0),
    [downloads],
  );

  // Peak speed of the current active burst. It records the fastest totalSpeed
  // while downloads are running and resets to 0 when the queue goes idle, so
  // the sidebar shows a clean "—" instead of yesterday's numbers.
  useEffect(() => {
    if (counts.active === 0) setPeakSpeed(0);
    else if (totalSpeed > peakSpeed) setPeakSpeed(totalSpeed);
  }, [counts.active, totalSpeed, peakSpeed]);

  const totalBytes = useMemo(
    () =>
      downloads
        .filter((d) => isActive(d.status))
        .reduce((s, d) => s + d.received, 0),
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
    // Exclude items pending removal (undo window still open).
    list = list.filter((d) => !pendingRemoveIds.has(d.id));
    return list;
  }, [sortedAll, filter, query, pendingRemoveIds]);

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
      cookies?: string | null,
    ) => {
      try {
        const d = await api.startDownload(url, path, speedLimit, null, referrer, cookies);
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

  const scheduleRemove = useCallback(
    (d: DownloadInfo) => {
      if (pendingRemove.current.has(d.id)) return;
      const timer = setTimeout(() => {
        pendingRemove.current.delete(d.id);
        setPendingRemoveIds((prev) => {
          const next = new Set(prev);
          next.delete(d.id);
          return next;
        });
        void api.remove(d.id).catch(() => {});
      }, 6000);
      pendingRemove.current.set(d.id, timer);
      setPendingRemoveIds((prev) => new Set(prev).add(d.id));
      notify(t("removedToast", { name: d.filename }), "info", {
        label: t("undo"),
        onClick: () => {
          const tmr = pendingRemove.current.get(d.id);
          if (tmr) {
            clearTimeout(tmr);
            pendingRemove.current.delete(d.id);
            setPendingRemoveIds((prev) => {
              const next = new Set(prev);
              next.delete(d.id);
              return next;
            });
          }
        },
      });
    },
    [notify, t],
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
      scheduleRemove(d);
    },
    [scheduleRemove, settings.deleteWithRemove, t],
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
    const ids = finished.map((d) => d.id);
    for (const d of finished) {
      if (pendingRemove.current.has(d.id)) continue;
      const timer = setTimeout(() => {
        pendingRemove.current.delete(d.id);
        void api.remove(d.id).catch(() => {});
      }, 8000);
      pendingRemove.current.set(d.id, timer);
    }
    setPendingRemoveIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    notify(t("clearedToast", { n: num(n) }), "info", {
      label: t("undo"),
      onClick: () => {
        for (const d of finished) {
          const tmr = pendingRemove.current.get(d.id);
          if (tmr) {
            clearTimeout(tmr);
            pendingRemove.current.delete(d.id);
          }
        }
        setPendingRemoveIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      },
    });
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
      const now = Date.now();
      if (now - folderOpenGate.current < 500) {
        notify(t("waitFolder"), "info");
        return;
      }
      folderOpenGate.current = now;
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

  const toggleSelect = useCallback((id: string, multi: boolean) => {
    setSelectedIds((prev) => {
      if (!multi) return new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  /** Batch action over every selected download (multi-select toolbar). */
  const batchAction = useCallback(
    (kind: "pause" | "resume" | "retry" | "remove") => {
      const targets = downloads.filter((d) => selectedIds.has(d.id));
      if (kind === "remove") {
        for (const d of targets) scheduleRemove(d);
        return;
      }
      void runAction(async () => {
        for (const d of targets) {
          if (kind === "pause" && isActive(d.status)) await api.pause(d.id);
          else if (kind === "resume" && d.status === "paused") await api.resume(d.id);
          else if (kind === "retry" && (d.status === "failed" || d.status === "cancelled")) await api.retry(d.id);
        }
      }, "");
    },
    [downloads, selectedIds, scheduleRemove, runAction],
  );

  /** Drag & drop queue reorder — indexes are resolved in the full queue. */
  const onReorder = useCallback(
    (dragId: string, overId: string) => {
      if (dragId === overId) return;
      const from = sortedAll.findIndex((d) => d.id === dragId);
      const to = sortedAll.findIndex((d) => d.id === overId);
      if (from === -1 || to === -1 || from === to) return;
      // The backend inserts at `to` *after* removing the dragged item, so a
      // downward drop shifts the target by one — compensate so dropping "on"
      // a card puts the dragged item exactly in the target's slot.
      const target = from < to ? to - 1 : to;
      void runAction(() => api.reorder(dragId, target), "");
    },
    [sortedAll, runAction],
  );

  // Keep the keyboard handler's refs in sync with latest callbacks.
  kRefs.current = { sortedAll, runAction, closeCtx, removeDownload, onOpenFile, onOpenFolder, ctx };

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
    if (d.status !== "completed") {
      items.push({
        label: t("setSpeedLimit"),
        icon: <BoltIcon width={14} height={14} />,
        onClick: () => setLimitTarget(d),
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
        <ParticleField theme={resolvedTheme} />
        <div className="grain" aria-hidden />
        <Titlebar />
        <div className="app-body">
          <Sidebar
            filter={filter}
            onFilter={setFilter}
            counts={counts}
            totalSpeed={totalSpeed}
            peakSpeed={peakSpeed}
            totalBytes={totalBytes}
            activeCount={counts.active}
            maxConcurrent={settings.maxConcurrent}
            onMaxConcurrent={(v) => update({ maxConcurrent: v })}
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

              {selectedIds.size > 1 && (
                <div className="selection-bar">
                  <span className="selection-count">
                    {t("nSelected", { n: num(selectedIds.size) })}
                  </span>
                  <div className="selection-actions">
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => batchAction("pause")}
                      disabled={!selectedIds.size || !downloads.some((d) => selectedIds.has(d.id) && isActive(d.status))}
                      title={t("pause")}
                    >
                      <PauseIcon width={14} height={14} />
                      {t("pause")}
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => batchAction("resume")}
                      disabled={!downloads.some((d) => selectedIds.has(d.id) && d.status === "paused")}
                      title={t("resume")}
                    >
                      <PlayIcon width={14} height={14} />
                      {t("resume")}
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => batchAction("retry")}
                      disabled={!downloads.some((d) => selectedIds.has(d.id) && (d.status === "failed" || d.status === "cancelled"))}
                      title={t("tryAgain")}
                    >
                      <RefreshIcon width={14} height={14} />
                      {t("tryAgain")}
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => batchAction("remove")}
                      title={t("remove")}
                    >
                      <TrashIcon width={14} height={14} />
                      {t("remove")}
                    </button>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={clearSelection}
                    title={t("clearSelection")}
                    aria-label={t("clearSelection")}
                  >
                    <XIcon width={15} height={15} />
                  </button>
                </div>
              )}

              <DownloadList
                downloads={filtered}
                filter={filter}
                selectedIds={selectedIds}
                onSelect={toggleSelect}
                onReorder={onReorder}
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
        {limitTarget && (
          <SpeedLimitModal
            d={limitTarget}
            onClose={() => setLimitTarget(null)}
            onSave={async (mb) => {
              const d = limitTarget;
              try {
                await api.setSpeedLimit(d.id, Math.round(mb * 1024 * 1024));
                notify(t("speedLimitSaved"), "success");
              } catch (e) {
                notify(String(e), "error");
              }
            }}
          />
        )}
        <ToastStack toasts={toasts} onDismiss={(id) => dismissToast(setToasts, id)} />
      </div>
    </I18nProvider>
  );
}

export default App;
