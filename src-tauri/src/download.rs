use crate::models::{status, AppSettings, CategoryRule, DownloadInfo, SegmentInfo, UrlMeta};
use futures_util::StreamExt;
use percent_encoding::percent_decode_str;
use reqwest::{header, Client, Proxy, StatusCode};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

/// Files smaller than this stay single-connection.
pub const SEGMENT_MIN_SIZE: u64 = 16 * 1024 * 1024; // 16 MB
pub const MAX_SEGMENTS: usize = 8;
/// How many times a segment retries a 416 (Range Not Satisfiable) before the
/// download falls back to a single stream. A 416 on a valid range is usually
/// the host being flaky, so a short retry often succeeds.
pub const SEGMENT_416_RETRIES: u32 = 3;

/// Bytes pulled when sampling the connection for speed estimation during a
/// probe. Larger samples give a steadier readout but cost a little more
/// bandwidth on every probe; 256 KiB is a good balance for a first-impression
/// ETA without noticeably delaying the Start button.
const SPEED_SAMPLE_BYTES: u64 = 256 * 1024; // 256 KiB

/// Write-behind buffer for segment/single-stream writes. Chunks arrive in
/// ~16 KB TCP pieces; coalescing them into larger sequential writes cuts
/// syscalls dramatically (matters on HDDs and under speed limits).
const WRITE_BUF_SIZE: usize = 256 * 1024;

/// Time constant (seconds) of the speed smoother. Larger = stabler readout;
/// ~1 s smooths out bursty TCP sampling without making ETA feel sluggish.
const SPEED_SMOOTH_TC: f64 = 1.0;

const PART_EXT: &str = ".driftpart";

/// 0 = none, 1 = pause, 2 = cancel
pub type Action = AtomicU8;

/// Smoothed speed tracker. Keeps the last sample time, the cumulative byte
/// offset at that sample, and an exponentially smoothed speed so the UI sees
/// a stable readout instead of raw instantaneous speed (which jumps wildly
/// because TCP traffic arrives in bursts).
pub struct SpeedState {
    /// timestamp of the last speed sample
    pub last: Instant,
    /// cumulative bytes received at the last sample
    pub last_received: u64,
    /// exponentially smoothed speed, bytes/second
    pub speed: f64,
}

impl SpeedState {
    /// Fresh tracker starting from the given byte offset (e.g. on resume, so
    /// the first sample is measured against the real offset, not zero).
    pub fn at(offset: u64) -> Self {
        Self {
            last: Instant::now(),
            last_received: offset,
            speed: 0.0,
        }
    }
}

pub struct DownloadEntry {
    pub info: Mutex<DownloadInfo>,
    pub action: Action,
    /// live per-segment counters (segmented downloads)
    pub seg_recv: Vec<Arc<AtomicU64>>,
    pub speed_state: Mutex<SpeedState>,
    /// Optional per-download proxy client, built lazily from `info.proxy`.
    pub client_override: Mutex<Option<Client>>,
    /// Server-provided Retry-After hint in seconds (429/503 responses); 0 = none.
    pub retry_after: AtomicU64,
}

pub enum AttemptOutcome {
    Done,
    Paused,
    Cancelled,
    Failed(String),
    RangeFallback,
}

enum AttemptError {
    Aborted,
    Unsupported,
    /// A segment request returned 416 Range Not Satisfiable: the server rejected
    /// the requested byte range, almost always because the real file is smaller
    /// than the size reported during the initial probe. The caller re-probes the
    /// true size and recomputes the segment plan instead of failing.
    RangeInvalid,
    Failed(String),
}

pub struct DownloadManager {
    pub app: AppHandle,
    client: Mutex<Client>,
    pub entries: Mutex<HashMap<String, Arc<DownloadEntry>>>,
    pub semaphore: Arc<Mutex<Arc<tokio::sync::Semaphore>>>,
    pub settings: Mutex<AppSettings>,
    pub active: AtomicUsize,
    dirty: AtomicU8, // 0 = clean, 1 = dirty
    /// Entry ids whose progress changed since the pump last drained them.
    /// One global ticker emits a single batched event instead of every worker
    /// spamming the frontend with its own IPC message.
    pending_progress: Mutex<HashSet<String>>,
}

/// Serialize `json` to `path` atomically: write `path.tmp` first, then rename
/// over `path`. A crash mid-write leaves the previous good file intact.
fn write_atomic(path: &Path, json: Option<&str>) {
    let Some(json) = json else { return };
    let tmp = path.with_extension("tmp");
    if fs::write(&tmp, json).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}

/// True when the main window is visible (not hidden to tray / minimized).
/// Used to suppress progress IPC while nothing is showing it.
fn window_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

/// Build the shared HTTP client, honoring the configured User-Agent and proxy.
/// An empty UA falls back to the built-in `drift/<version>` agent (some servers
/// block unknown agents, so users can override it in Settings → Network).
/// `proxy_mode` is "system" (OS/env proxy), "none" (disable), or "custom"
/// (use `proxy_url`). Returns Err when the proxy URL can't be parsed.
fn build_client(user_agent: &str, proxy_mode: &str, proxy_url: &str) -> Result<Client, String> {
    let ua = if user_agent.trim().is_empty() {
        format!("drift/{}", env!("CARGO_PKG_VERSION"))
    } else {
        user_agent.trim().to_string()
    };
    let mut builder = Client::builder()
        .user_agent(ua)
        .connect_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10));
    match proxy_mode {
        "none" => {
            builder = builder.no_proxy();
        }
        "custom" if !proxy_url.trim().is_empty() => {
            let p = Proxy::all(proxy_url.trim()).map_err(|e| format!("Invalid proxy URL: {e}"))?;
            builder = builder.proxy(p);
        }
        _ => {}
    }
    builder
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

/// Like `build_client` but never fails: on error it logs and returns a plain
/// client so the app can keep running.
pub(crate) fn make_client(user_agent: &str, proxy_mode: &str, proxy_url: &str) -> Client {
    build_client(user_agent, proxy_mode, proxy_url).unwrap_or_else(|e| {
        eprintln!("drift: {e} — falling back to a default client");
        Client::new()
    })
}

impl DownloadManager {
    /// Drop completed entries older than `days` from the list (never touches
    /// files on disk). Runs at startup and whenever the setting changes; keeps
    /// downloads.json and the UI list small on long-lived installs.
    pub fn auto_clean(&self, days: u32) {
        if days == 0 {
            return;
        }
        let cutoff = now_millis().saturating_sub(days as u64 * 24 * 3600 * 1000);
        let ids: Vec<String> = self
            .entries
            .lock()
            .unwrap()
            .values()
            .filter(|e| {
                let info = e.info.lock().unwrap();
                info.status == status::COMPLETED
                    && info.completed_at.map(|t| t < cutoff).unwrap_or(false)
            })
            .map(|e| e.info.lock().unwrap().id.clone())
            .collect();
        for id in ids {
            let _ = self.remove(&id);
        }
    }

    pub fn new(app: AppHandle, settings: AppSettings) -> Self {
        let sem = Arc::new(tokio::sync::Semaphore::new(settings.max_concurrent.max(1)));
        Self {
            app,
            client: Mutex::new(make_client(
                &settings.user_agent,
                &settings.proxy_mode,
                &settings.proxy_url,
            )),
            entries: Mutex::new(HashMap::new()),
            semaphore: Arc::new(Mutex::new(sem)),
            settings: Mutex::new(settings),
            active: AtomicUsize::new(0),
            dirty: AtomicU8::new(0),
            pending_progress: Mutex::new(HashSet::new()),
        }
    }

    /// Clone of the shared HTTP client (cloning a reqwest client is cheap —
    /// the connection pool is shared). Rebuilt when the User-Agent or proxy
    /// settings change.
    pub fn client(&self) -> Client {
        self.client.lock().unwrap().clone()
    }

    /// The HTTP client for a specific download: a per-download proxy override
    /// if one was set, otherwise the shared client.
    pub fn client_for(&self, entry: &DownloadEntry) -> Client {
        let mut cached = entry.client_override.lock().unwrap();
        if let Some(c) = cached.as_ref() {
            return c.clone();
        }
        let proxy = entry.info.lock().unwrap().proxy.clone();
        let client = match proxy.filter(|p| !p.trim().is_empty()) {
            Some(p) => make_client(&self.settings.lock().unwrap().user_agent, "custom", &p),
            None => self.client(),
        };
        *cached = Some(client.clone());
        client
    }

    // ---------------------------------------------------------------- state

    pub fn load_state(app: &AppHandle) -> (Vec<DownloadInfo>, AppSettings) {
        let dir = app.path().app_data_dir().unwrap_or_default();
        let settings: AppSettings = fs::read_to_string(dir.join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let dl_path = dir.join("downloads.json");
        let infos: Vec<DownloadInfo> = fs::read_to_string(&dl_path)
            .ok()
            .and_then(|s| match serde_json::from_str(&s) {
                Ok(v) => Some(v),
                Err(e) => {
                    eprintln!(
                        "drift: corrupt downloads.json ({e}) — backing up and starting fresh"
                    );
                    let _ = fs::rename(&dl_path, dir.join("downloads.json.bak"));
                    None
                }
            })
            .unwrap_or_default();
        let infos = infos
            .into_iter()
            .map(|mut i| {
                // Anything that was mid-flight when the app closed resumes as paused.
                if matches!(
                    i.status.as_str(),
                    status::QUEUED | status::DOWNLOADING | status::RETRYING
                ) {
                    i.status = status::PAUSED.into();
                    i.speed = 0.0;
                    i.error = None;
                    i.received = received_from_parts(&i);
                    let path = i.path.clone();
                    for seg in i.segments.iter_mut() {
                        let p = part_path(Path::new(&path), seg.index);
                        seg.received = file_len(&p).unwrap_or(0).min(seg.expected_len());
                    }
                }
                i
            })
            .collect();
        (infos, settings)
    }

    pub fn restore_entry(&self, info: DownloadInfo) {
        let n = info.segments.len();
        let entry = Arc::new(DownloadEntry {
            info: Mutex::new(info),
            action: AtomicU8::new(0),
            seg_recv: (0..n).map(|_| Arc::new(AtomicU64::new(0))).collect(),
            speed_state: Mutex::new(SpeedState::at(0)),
            client_override: Mutex::new(None),
            retry_after: AtomicU64::new(0),
        });
        let id = entry.info.lock().unwrap().id.clone();
        self.entries.lock().unwrap().insert(id, entry);
    }

    /// Mark state as dirty. The background batcher writes to disk every ~5s.
    /// Call `flush()` directly for critical state transitions (complete,
    /// failed, cancel, remove) so they survive a crash immediately.
    pub fn persist(&self) {
        self.dirty.store(1, Ordering::SeqCst);
    }

    /// Write state to disk immediately — call on critical transitions.
    pub fn flush(&self) {
        self.dirty.store(0, Ordering::SeqCst);
        let infos: Vec<DownloadInfo> = self
            .entries
            .lock()
            .unwrap()
            .values()
            .map(|e| e.info.lock().unwrap().clone())
            // Cookies (session tokens from the browser) are never written to
            // disk — they live in memory only, for the current session's
            // requests. A restart simply means re-handing the download from
            // the browser.
            .map(|mut i| {
                i.cookies = None;
                i
            })
            .collect();
        let dir = self.app.path().app_data_dir().unwrap_or_default();
        let _ = fs::create_dir_all(&dir);
        // Atomic writes: write to a temp file then rename over the target so a
        // crash mid-write can never truncate/corrupt the real state file.
        write_atomic(
            &dir.join("downloads.json"),
            serde_json::to_string_pretty(&infos).ok().as_deref(),
        );
        let settings = self.settings.lock().unwrap().clone();
        write_atomic(
            &dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).ok().as_deref(),
        );
    }

    /// Background task: flush to disk every 5s if the dirty flag is set.
    pub fn start_batcher(self: &Arc<Self>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(5));
            loop {
                ticker.tick().await;
                if this.dirty.swap(0, Ordering::SeqCst) == 1 {
                    this.flush();
                }
            }
        });
    }

    pub fn snapshot(&self) -> Vec<DownloadInfo> {
        self.entries
            .lock()
            .unwrap()
            .values()
            .map(|e| e.info.lock().unwrap().clone())
            .collect()
    }

    pub fn emit_list(&self) {
        let _ = self.app.emit("download://list", self.snapshot());
    }

    pub fn emit_progress(&self, entry: &DownloadEntry) {
        // Nobody is listening while the main window is hidden to the tray —
        // skip the JSON serialize + IPC round-trip entirely. The 5s batcher
        // still persists state, so nothing is lost.
        if !window_visible(&self.app) {
            return;
        }
        let info = entry.info.lock().unwrap().clone();
        let _ = self.app.emit("download://progress", info);
    }

    /// Queue an entry id for the next batched progress emission. Cheap —
    /// workers call this every chunk without any locking contention beyond
    /// the short set insert.
    pub fn mark_progress(&self, id: &str) {
        self.pending_progress.lock().unwrap().insert(id.to_string());
    }

    /// Background pump: every 200ms, emit one list-style event containing all
    /// entries whose progress changed, replacing the per-worker per-chunk
    /// event storm (previously up to ~7 events/s per download).
    pub fn start_progress_pump(self: &Arc<Self>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(200));
            loop {
                ticker.tick().await;
                let ids: Vec<String> = {
                    let mut set = this.pending_progress.lock().unwrap();
                    set.drain().collect::<Vec<_>>()
                };
                if ids.is_empty() || !window_visible(&this.app) {
                    continue;
                }
                let entries = this.entries.lock().unwrap();
                let mut payload: Vec<DownloadInfo> = Vec::with_capacity(ids.len());
                for id in &ids {
                    if let Some(e) = entries.get(id) {
                        payload.push(e.info.lock().unwrap().clone());
                    }
                }
                drop(entries);
                if !payload.is_empty() {
                    let _ = this.app.emit("download://progress-batch", payload);
                }
            }
        });
    }

    // ------------------------------------------------------------- commands

    pub async fn start_download(
        self: &Arc<Self>,
        url: String,
        path: String,
        speed_limit: Option<u64>,
        segmented: Option<bool>,
        referrer: Option<String>,
        cookies: Option<String>,
        hash: Option<String>,
        proxy: Option<String>,
    ) -> Result<DownloadInfo, String> {
        let url = url.trim().to_string();
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("URL must start with http:// or https://".into());
        }
        let base_dir = Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        fs::create_dir_all(&base_dir).map_err(|e| format!("Cannot create folder: {e}"))?;
        let raw_name = Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .map(sanitize_filename)
            .unwrap_or_else(|| "download".into());

        // Per-download proxy override (built now so the probe also uses it).
        let proxy = proxy.filter(|p| !p.trim().is_empty());
        let probe_client = match &proxy {
            Some(p) => make_client(&self.settings.lock().unwrap().user_agent, "custom", p),
            None => self.client(),
        };
        // No speed sample: starting a download measures speed for real, so
        // sampling here only delayed the start and burned 256 KiB.
        let meta = probe_url(
            &probe_client,
            &url,
            referrer.as_deref(),
            cookies.as_deref(),
            false,
        )
        .await?;

        // Auto-categorize: route into a per-type subfolder when enabled and a
        // rule matches the extension or MIME type.
        let settings = self.settings.lock().unwrap().clone();
        let mut dir = base_dir.clone();
        let filename = raw_name.clone();
        if settings.auto_categorize {
            if let Some(sub) = categorize(
                &settings.category_rules,
                &filename,
                meta.content_type.as_deref(),
            ) {
                dir = base_dir.join(sub);
                let _ = fs::create_dir_all(&dir);
            }
        }
        // If a download is already in progress for this name, pick a unique one
        // so an active .part file is never clobbered.
        let final_path = if part_exists(&dir, &filename) {
            unique_path(&dir, &filename)
        } else {
            dir.join(&filename)
        };
        let filename = final_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("download")
            .to_string();

        // Fail fast (with a clear message) when the disk can't hold the file.
        if let Some(size) = meta.size {
            if let Some(free) = free_space(&dir) {
                if free < size {
                    return Err(format!(
                        "Not enough disk space: need {}, only {} free",
                        fmt_bytes(size),
                        fmt_bytes(free)
                    ));
                }
            }
        }

        let want_segmented = segmented.unwrap_or(settings.segmented)
            && meta.supports_ranges
            && meta.size.unwrap_or(0) >= SEGMENT_MIN_SIZE;
        // Parallel connections per download are their own setting — decoupled
        // from max_concurrent (the queue limit) so a single huge download can
        // still use every connection.
        let max_seg = MAX_SEGMENTS.min(settings.max_connections.clamp(1, MAX_SEGMENTS));
        let nseg = if want_segmented {
            let size = meta.size.unwrap_or(0);
            (((size / SEGMENT_MIN_SIZE) as usize) + 1)
                .min(max_seg)
                .max(2)
        } else {
            0
        };

        let mut segments = Vec::new();
        if nseg > 0 {
            let size = meta.size.unwrap();
            let base = size / nseg as u64;
            let mut start = 0u64;
            for i in 0..nseg {
                let end = if i == nseg - 1 {
                    size - 1
                } else {
                    start + base - 1
                };
                segments.push(SegmentInfo {
                    index: i,
                    start,
                    end,
                    received: 0,
                });
                start = end + 1;
            }
        }

        let limit = speed_limit.unwrap_or(settings.default_speed_limit);
        let now = now_millis();
        let priority = self.next_priority();
        let info = DownloadInfo {
            id: Uuid::new_v4().to_string(),
            url: url.clone(),
            referrer,
            cookies,
            filename: filename.clone(),
            dir: dir.display().to_string(),
            path: final_path.display().to_string(),
            total_size: meta.size,
            received: 0,
            status: status::QUEUED.into(),
            speed: 0.0,
            error: None,
            created_at: now,
            updated_at: now,
            segments,
            segmented: nseg > 0,
            supports_ranges: meta.supports_ranges,
            retries: 0,
            speed_limit: limit,
            hash: hash.filter(|h| !h.trim().is_empty()),
            verified: false,
            proxy: proxy.clone(),
            completed_at: None,
            priority,
            etag: None,
            last_modified: None,
        };
        let entry = Arc::new(DownloadEntry {
            info: Mutex::new(info),
            action: AtomicU8::new(0),
            seg_recv: (0..nseg).map(|_| Arc::new(AtomicU64::new(0))).collect(),
            speed_state: Mutex::new(SpeedState::at(0)),
            client_override: Mutex::new(None),
            retry_after: AtomicU64::new(0),
        });
        let id = entry.info.lock().unwrap().id.clone();
        self.entries.lock().unwrap().insert(id, entry.clone());
        self.persist();
        self.emit_list();
        self.spawn_worker(entry.clone());
        let started = entry.info.lock().unwrap().clone();
        Ok(started)
    }

    pub fn pause(&self, id: &str) -> Result<(), String> {
        let entry = self.get(id)?;
        let status = entry.info.lock().unwrap().status.clone();
        if matches!(
            status.as_str(),
            status::COMPLETED | status::FAILED | status::CANCELLED | status::PAUSED
        ) {
            return Err(format!("Cannot pause a {status} download"));
        }
        entry.action.store(1, Ordering::SeqCst);
        Ok(())
    }

    pub fn resume(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let entry = self.get(id)?;
        let status = entry.info.lock().unwrap().status.clone();
        if status != status::PAUSED {
            return Err(format!("Cannot resume a {status} download"));
        }
        // The disk may have filled up while the download sat paused — re-check
        // against what still remains to be fetched.
        {
            let info = entry.info.lock().unwrap();
            if let Some(total) = info.total_size {
                let remaining = total.saturating_sub(info.received);
                let dir = PathBuf::from(&info.dir);
                if remaining > 0 {
                    if let Some(free) = free_space(&dir) {
                        if free < remaining {
                            return Err(format!(
                                "Not enough disk space to resume: need {}, only {} free",
                                fmt_bytes(remaining),
                                fmt_bytes(free)
                            ));
                        }
                    }
                }
            }
        }
        entry.action.store(0, Ordering::SeqCst);
        {
            let mut info = entry.info.lock().unwrap();
            info.status = status::QUEUED.into();
            info.error = None;
            info.retries = 0;
            info.updated_at = now_millis();
        }
        self.persist();
        self.emit_list();
        self.spawn_worker(entry);
        Ok(())
    }

    pub fn retry(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let entry = self.get(id)?;
        let status = entry.info.lock().unwrap().status.clone();
        if !matches!(status.as_str(), status::FAILED | status::CANCELLED) {
            return Err(format!("Cannot retry a {status} download"));
        }
        {
            let mut info = entry.info.lock().unwrap();
            info.status = status::QUEUED.into();
            info.error = None;
            info.retries = 0;
            info.speed = 0.0;
            info.completed_at = None;
            info.updated_at = now_millis();
        }
        // Keep partial data on disk: the attempt re-measures the .part files
        // and resumes from where it stopped, instead of restarting from zero.
        self.persist();
        self.emit_list();
        self.spawn_worker(entry);
        Ok(())
    }

    pub fn pause_all(&self) -> usize {
        let entries: Vec<Arc<DownloadEntry>> =
            self.entries.lock().unwrap().values().cloned().collect();
        let mut n = 0;
        for e in entries {
            let status = e.info.lock().unwrap().status.clone();
            if matches!(
                status.as_str(),
                status::QUEUED | status::DOWNLOADING | status::RETRYING
            ) {
                e.action.store(1, Ordering::SeqCst);
                n += 1;
            }
        }
        n
    }

    pub fn resume_all(self: &Arc<Self>) -> usize {
        let entries: Vec<Arc<DownloadEntry>> =
            self.entries.lock().unwrap().values().cloned().collect();
        let mut n = 0;
        for e in entries {
            let status = e.info.lock().unwrap().status.clone();
            if status == status::PAUSED {
                e.action.store(0, Ordering::SeqCst);
                {
                    let mut info = e.info.lock().unwrap();
                    info.status = status::QUEUED.into();
                    info.error = None;
                    info.retries = 0;
                    info.updated_at = now_millis();
                }
                self.spawn_worker(e);
                n += 1;
            }
        }
        self.persist();
        self.emit_list();
        n
    }

    /// Move `id` to `to_index` in the queue (0 = front) and renumber every
    /// entry's priority so the frontend gets a stable, persisted ordering.
    pub fn reorder(&self, id: &str, to_index: usize) -> Result<(), String> {
        let entries = self.entries.lock().unwrap();
        let mut order: Vec<DownloadInfo> = entries
            .values()
            .map(|e| e.info.lock().unwrap().clone())
            .collect();
        order.sort_by(|a, b| {
            a.priority
                .cmp(&b.priority)
                .then(b.created_at.cmp(&a.created_at))
        });
        let pos = order
            .iter()
            .position(|d| d.id == id)
            .ok_or_else(|| "Download not found".to_string())?;
        let entry = order.remove(pos);
        let to = to_index.min(order.len());
        order.insert(to, entry);
        for (i, d) in order.iter().enumerate() {
            if let Some(e) = entries.get(&d.id) {
                e.info.lock().unwrap().priority = i as i64;
            }
        }
        drop(entries);
        self.persist();
        self.emit_list();
        Ok(())
    }

    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let entry = self.get(id)?;
        let status = entry.info.lock().unwrap().status.clone();
        if status == status::COMPLETED {
            return Err("Completed downloads cannot be cancelled".into());
        }
        entry.action.store(2, Ordering::SeqCst);
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let entry = self
            .entries
            .lock()
            .unwrap()
            .remove(id)
            .ok_or("Download not found")?;
        let status = entry.info.lock().unwrap().status.clone();
        let active = matches!(
            status.as_str(),
            status::QUEUED | status::DOWNLOADING | status::RETRYING
        );
        if active {
            // The worker thread will stop and mark the entry cancelled when it
            // notices the action; remove() deletes the partial files itself
            // (cancel alone keeps them so the entry can be retried/resumed).
            entry.action.store(2, Ordering::SeqCst);
            // Give the worker a moment to stop writing before deleting parts,
            // so a still-open file handle doesn't orphan a .part on Windows.
            std::thread::sleep(Duration::from_millis(150));
            self.cleanup_parts(&entry);
            // Cover the race where the worker already finalized the file.
            if self.settings.lock().unwrap().delete_with_remove {
                let _ = fs::remove_file(&entry.info.lock().unwrap().path);
            }
        } else {
            self.cleanup_parts(&entry);
            if self.settings.lock().unwrap().delete_with_remove {
                let _ = fs::remove_file(&entry.info.lock().unwrap().path);
            }
        }
        self.flush();
        self.emit_list();
        Ok(())
    }

    pub fn set_settings(&self, settings: AppSettings) {
        let mut cur = self.settings.lock().unwrap();
        if cur.max_concurrent != settings.max_concurrent {
            *self.semaphore.lock().unwrap() =
                Arc::new(tokio::sync::Semaphore::new(settings.max_concurrent.max(1)));
        }
        if cur.user_agent != settings.user_agent
            || cur.proxy_mode != settings.proxy_mode
            || cur.proxy_url != settings.proxy_url
        {
            *self.client.lock().unwrap() = make_client(
                &settings.user_agent,
                &settings.proxy_mode,
                &settings.proxy_url,
            );
        }
        let clean_days_changed = cur.auto_clean_days != settings.auto_clean_days;
        *cur = settings;
        drop(cur);
        if clean_days_changed {
            self.auto_clean(self.settings.lock().unwrap().auto_clean_days);
        }
    }

    /// Change a running download's speed limit (bytes/second, 0 = unlimited).
    /// The workers re-read the limit on every chunk, so it applies live.
    pub fn set_speed_limit(&self, id: &str, limit: u64) -> Result<(), String> {
        let entry = self.get(id)?;
        entry.info.lock().unwrap().speed_limit = limit;
        self.persist();
        self.mark_progress(&entry.info.lock().unwrap().id);
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Arc<DownloadEntry>, String> {
        self.entries
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| "Download not found".into())
    }

    // --------------------------------------------------------------- workers

    fn spawn_worker(self: &Arc<Self>, entry: Arc<DownloadEntry>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let sem = this.semaphore.lock().unwrap().clone();
            let _permit = match sem.acquire_owned().await {
                Ok(p) => p,
                Err(_) => return,
            };
            this.active.fetch_add(1, Ordering::SeqCst);
            {
                let mut info = entry.info.lock().unwrap();
                info.status = status::DOWNLOADING.into();
                info.error = None;
                info.updated_at = now_millis();
            }
            this.emit_progress(&entry);
            this.run_download_loop(entry.clone()).await;
            this.active.fetch_sub(1, Ordering::SeqCst);
        });
    }

    async fn run_download_loop(self: &Arc<Self>, entry: Arc<DownloadEntry>) {
        let settings = self.settings.lock().unwrap().clone();
        let mut retries: u32 = entry.info.lock().unwrap().retries;
        let max_retries = if settings.auto_retry {
            settings.max_retries
        } else {
            0
        };
        loop {
            let outcome = self.attempt(entry.clone()).await;
            match outcome {
                AttemptOutcome::Done => {
                    {
                        let mut info = entry.info.lock().unwrap();
                        info.status = status::COMPLETED.into();
                        info.received = info.total_size.unwrap_or(info.received);
                        info.speed = 0.0;
                        info.error = None;
                        info.completed_at = Some(now_millis());
                        info.updated_at = now_millis();
                    }
                    self.flush();
                    self.emit_list();
                    self.notify_complete(&entry);
                    break;
                }
                AttemptOutcome::Paused => {
                    self.finalize_received(&entry);
                    let mut info = entry.info.lock().unwrap();
                    info.status = status::PAUSED.into();
                    info.speed = 0.0;
                    info.updated_at = now_millis();
                    drop(info);
                    self.persist();
                    self.emit_list();
                    break;
                }
                AttemptOutcome::Cancelled => {
                    let mut info = entry.info.lock().unwrap();
                    info.status = status::CANCELLED.into();
                    info.speed = 0.0;
                    info.error = Some("Cancelled".into());
                    info.updated_at = now_millis();
                    drop(info);
                    // Partial data is kept on disk so "Retry" can resume from
                    // where the download stopped instead of restarting.
                    self.flush();
                    self.emit_list();
                    break;
                }
                AttemptOutcome::Failed(msg) => {
                    if is_retryable(&msg) && retries < max_retries {
                        retries += 1;
                        {
                            let mut info = entry.info.lock().unwrap();
                            info.retries = retries;
                            info.status = status::RETRYING.into();
                            info.error = Some(format!("Retry {retries}/{max_retries}: {msg}"));
                            info.updated_at = now_millis();
                        }
                        self.mark_progress(&entry.info.lock().unwrap().id);
                        self.persist();
                        // Exponential backoff with jitter, plus the server's
                        // own Retry-After hint when it sent one. Jitter keeps
                        // N concurrent retries from hammering the host in
                        // lockstep (thundering herd).
                        let retry_after = self.retry_after_hint(&entry);
                        let base = (1u64 << retries.min(5)).min(30);
                        let jitter = (SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map(|t| t.subsec_millis() as u64)
                            .unwrap_or(0)
                            % 500) as f64
                            / 1000.0;
                        let mut backoff = Duration::from_secs_f64((base as f64 + jitter).min(60.0));
                        if let Some(ra) = retry_after {
                            backoff = backoff.max(ra);
                        }
                        tokio::time::sleep(backoff).await;
                        continue;
                    }
                    {
                        let mut info = entry.info.lock().unwrap();
                        info.status = status::FAILED.into();
                        info.speed = 0.0;
                        info.error = Some(msg.clone());
                        info.updated_at = now_millis();
                    }
                    self.flush();
                    self.emit_list();
                    self.notify_failed(&entry, &msg);
                    break;
                }
                // attempt() resolves range fallbacks internally; this is a safety net.
                AttemptOutcome::RangeFallback => {
                    let mut info = entry.info.lock().unwrap();
                    info.status = status::FAILED.into();
                    info.speed = 0.0;
                    info.error = Some("Server does not support segmented downloads".into());
                    info.updated_at = now_millis();
                    drop(info);
                    self.persist();
                    self.emit_list();
                    break;
                }
            }
        }
    }

    async fn attempt(self: &Arc<Self>, entry: Arc<DownloadEntry>) -> AttemptOutcome {
        // Honor a pause/cancel requested while waiting for a permit slot.
        let pending = entry.action.load(Ordering::SeqCst);
        if pending != 0 {
            return match entry.action.swap(0, Ordering::SeqCst) {
                1 => AttemptOutcome::Paused,
                2 => AttemptOutcome::Cancelled,
                _ => unreachable!(),
            };
        }
        let (url, segmented, supports_ranges, total_size, referrer) = {
            let info = entry.info.lock().unwrap();
            (
                info.url.clone(),
                info.segmented,
                info.supports_ranges,
                info.total_size,
                info.referrer.clone(),
            )
        };
        if segmented {
            match self
                .attempt_segmented(entry.clone(), url.clone(), referrer.clone())
                .await
            {
                AttemptOutcome::RangeFallback => {
                    // Server refused ranges mid-flight — fall back to a single stream.
                    {
                        let mut info = entry.info.lock().unwrap();
                        info.segmented = false;
                        info.segments.clear();
                        info.received = 0;
                        info.updated_at = now_millis();
                    }
                    self.cleanup_parts(&entry);
                    self.mark_progress(&entry.info.lock().unwrap().id);
                    self.attempt_single(entry, url, supports_ranges, total_size, referrer)
                        .await
                }
                other => other,
            }
        } else {
            self.attempt_single(entry, url, supports_ranges, total_size, referrer)
                .await
        }
    }

    async fn attempt_single(
        self: &Arc<Self>,
        entry: Arc<DownloadEntry>,
        url: String,
        supports_ranges: bool,
        total_size: Option<u64>,
        referrer: Option<String>,
    ) -> AttemptOutcome {
        let (path, _dir, cookies) = {
            let info = entry.info.lock().unwrap();
            (info.path.clone(), info.dir.clone(), info.cookies.clone())
        };
        let final_path = PathBuf::from(&path);
        let part = part_path(&final_path, 0);

        let mut start = 0u64;
        let mut append = false;
        if supports_ranges {
            if let Some(len) = file_len(&part) {
                start = len;
                append = start > 0;
            }
        }

        let client = self.client_for(&entry);
        // Send the request, then validate the remote against the ETag /
        // Last-Modified captured on the first attempt. If the file changed
        // under us while resuming, drop the partial data and re-request from
        // zero — appending would splice two different files together. At most
        // two passes: the second one is always a fresh (non-resume) request.
        let resp = loop {
            let mut req = client.get(&url);
            if let Some(r) = referrer.as_deref() {
                req = req.header(header::REFERER, r);
            }
            if let Some(c) = cookies.as_deref() {
                if !c.is_empty() {
                    req = req.header(header::COOKIE, c);
                }
            }
            if append {
                req = req.header(header::RANGE, format!("bytes={start}-"));
            }
            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) => return AttemptOutcome::Failed(e.to_string()),
            };
            let cur_etag = resp
                .headers()
                .get(header::ETAG)
                .and_then(|v| v.to_str().ok())
                .map(String::from);
            let cur_lm = resp
                .headers()
                .get(header::LAST_MODIFIED)
                .and_then(|v| v.to_str().ok())
                .map(String::from);
            if append {
                let (saved_etag, saved_lm) = {
                    let info = entry.info.lock().unwrap();
                    (info.etag.clone(), info.last_modified.clone())
                };
                let changed = saved_etag
                    .as_deref()
                    .zip(cur_etag.as_deref())
                    .map(|(a, b)| a != b)
                    .unwrap_or(false)
                    || saved_lm
                        .as_deref()
                        .zip(cur_lm.as_deref())
                        .map(|(a, b)| a != b)
                        .unwrap_or(false);
                if changed {
                    // Stale partial data — start over from byte 0.
                    let _ = fs::remove_file(&part);
                    {
                        let mut info = entry.info.lock().unwrap();
                        info.received = 0;
                        info.etag = None;
                        info.last_modified = None;
                    }
                    append = false;
                    start = 0;
                    continue;
                }
            } else {
                let mut info = entry.info.lock().unwrap();
                if info.etag.is_none() {
                    info.etag = cur_etag;
                }
                if info.last_modified.is_none() {
                    info.last_modified = cur_lm;
                }
            }
            break resp;
        };
        let status = resp.status();
        // 416 on a resume range (`bytes=start-`) means nothing remains: the
        // partial .part on disk already holds the complete file, so finalize it.
        let already_complete = status == StatusCode::RANGE_NOT_SATISFIABLE && append;
        let (mut received, append) = if status == StatusCode::PARTIAL_CONTENT {
            (start, true)
        } else if status.is_success() {
            (0u64, false)
        } else if already_complete {
            (start, true)
        } else {
            self.capture_retry_after(&entry, &resp);
            return AttemptOutcome::Failed(format!("HTTP {}", status.as_u16()));
        };
        // If the probe couldn't determine the size, learn it from the real
        // response headers so the UI can show %, remaining, and ETA at once.
        let learned = if status == StatusCode::PARTIAL_CONTENT {
            content_range_total(&resp)
        } else if status.is_success() {
            header_content_length(&resp)
        } else {
            None
        };
        {
            let mut info = entry.info.lock().unwrap();
            if info.total_size.is_none() {
                info.total_size = learned;
            }
            // A 416 on a resume range proves the file is exactly `start` bytes:
            // the partial .part already contains the whole file.
            if already_complete {
                info.total_size = Some(start);
            }
            info.received = received;
        }
        if learned.is_some() {
            self.mark_progress(&entry.info.lock().unwrap().id);
        }
        if received == 0 {
            let _ = fs::remove_file(&part);
        }
        // Avoid a fake speed spike on resume: the speed tracker must start
        // from the actual byte offset, not from zero.
        *entry.speed_state.lock().unwrap() = SpeedState::at(received);

        let file = match tokio::fs::OpenOptions::new()
            .create(true)
            .append(append)
            .write(true)
            .open(&part)
            .await
        {
            Ok(f) => f,
            Err(e) => return AttemptOutcome::Failed(format!("Cannot write file: {e}")),
        };
        // Coalesce ~16 KB TCP chunks into larger sequential writes.
        let mut file = tokio::io::BufWriter::with_capacity(WRITE_BUF_SIZE, file);

        if already_complete {
            // 416 on a resume range: the partial .part already holds the whole
            // file, so there is nothing left to download.
            let _ = file.flush().await;
        } else {
            let mut stream = resp.bytes_stream();
            let mut chunk_bytes = 0u64;
            let mut limit_instant = Instant::now();
            let mut cur_limit = 0u64; // 0 = unlimited; throttle window restarts on change
            let mut last_emit = Instant::now();
            while let Some(chunk) = stream.next().await {
                if entry.action.load(Ordering::SeqCst) != 0 {
                    break;
                }
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(e) => return AttemptOutcome::Failed(e.to_string()),
                };
                let len = chunk.len() as u64;
                if let Err(e) = file.write_all(&chunk).await {
                    return AttemptOutcome::Failed(format!("Write error: {e}"));
                }
                received += len;
                chunk_bytes += len;
                // One lock per chunk: persist received bytes and read the live limit
                // together (the limit read no longer takes a second lock). Holding
                // the info lock while computing effective_limit only locks `settings`
                // afterwards, which never nests settings->info, so there's no
                // deadlock risk.
                let eff_limit = {
                    let mut info = entry.info.lock().unwrap();
                    info.received = received;
                    self.effective_limit(info.speed_limit)
                };
                if eff_limit != cur_limit {
                    cur_limit = eff_limit;
                    chunk_bytes = 0;
                    limit_instant = Instant::now();
                }
                if cur_limit > 0 {
                    let elapsed = limit_instant.elapsed();
                    let target = Duration::from_secs_f64(chunk_bytes as f64 / cur_limit as f64);
                    if target > elapsed {
                        tokio::time::sleep(target - elapsed).await;
                    }
                    if entry.action.load(Ordering::SeqCst) != 0 {
                        break;
                    }
                }
                if last_emit.elapsed() >= Duration::from_millis(150) {
                    let id = entry.info.lock().unwrap().id.clone();
                    self.update_speed(&entry, received);
                    self.mark_progress(&id);
                    last_emit = Instant::now();
                }
            }
            let _ = file.flush().await;
        }

        let action = entry.action.swap(0, Ordering::SeqCst);
        if action != 0 {
            return match action {
                1 => AttemptOutcome::Paused,
                _ => AttemptOutcome::Cancelled,
            };
        }
        // Defensive: never finalize a file that came up short of its declared size.
        // Prefer the size learned from the real response, fall back to the probe.
        let declared = entry.info.lock().unwrap().total_size.or(total_size);
        if let Some(total) = declared {
            if received < total {
                return AttemptOutcome::Failed(format!(
                    "Incomplete transfer: got {received} of {total} bytes"
                ));
            }
        }
        if let Err(e) = rename_with_retry(&part, &final_path).await {
            return AttemptOutcome::Failed(format!("Finalize error: {e}"));
        }
        if let Err(e) = verify_hash(&entry, &final_path) {
            return AttemptOutcome::Failed(e);
        }
        {
            let mut info = entry.info.lock().unwrap();
            info.received = received;
            if info.total_size.is_none() {
                info.total_size = total_size;
            }
        }
        self.update_speed(&entry, received);
        self.mark_progress(&entry.info.lock().unwrap().id);
        AttemptOutcome::Done
    }

    async fn attempt_segmented(
        self: &Arc<Self>,
        entry: Arc<DownloadEntry>,
        url: String,
        referrer: Option<String>,
    ) -> AttemptOutcome {
        let path = entry.info.lock().unwrap().path.clone();
        let final_path = PathBuf::from(&path);

        // Rebuild segment offsets from whatever is already on disk.
        let mut segments: Vec<SegmentInfo> = {
            let info = entry.info.lock().unwrap();
            info.segments.clone()
        };
        for seg in segments.iter_mut() {
            let p = part_path(&final_path, seg.index);
            seg.received = file_len(&p).unwrap_or(0).min(seg.expected_len());
        }
        // Publish the disk truth back into the entry and reset the live counters
        // (they accumulate across attempts and would double-count on resume).
        let base = {
            let mut info = entry.info.lock().unwrap();
            for (i, seg) in segments.iter().enumerate() {
                if let Some(dest) = info.segments.get_mut(i) {
                    dest.received = seg.received;
                }
            }
            for c in &entry.seg_recv {
                c.store(0, Ordering::SeqCst);
            }
            let base: u64 = info.segments.iter().map(|s| s.received).sum();
            info.received = base;
            base
        };
        *entry.speed_state.lock().unwrap() = SpeedState::at(base);

        let (global_limit, active) = {
            let settings = self.settings.lock().unwrap();
            (
                settings.global_speed_limit,
                self.active.load(Ordering::SeqCst).max(1),
            )
        };

        // Live progress reporter.
        let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let f2 = finished.clone();
        let prog_entry = entry.clone();
        let prog_this = self.clone();
        let prog_task = tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(150));
            loop {
                ticker.tick().await;
                if f2.load(Ordering::SeqCst) {
                    break;
                }
                prog_this.mark_aggregate(&prog_entry);
            }
        });

        let seg_count = segments.len();
        let mut handles = Vec::new();
        let client = self.client_for(&entry);
        for seg in &segments {
            let entry = entry.clone();
            let url = url.clone();
            let referrer = referrer.clone();
            let client = client.clone();
            let seg = seg.clone();
            handles.push(tauri::async_runtime::spawn(async move {
                download_segment(
                    client,
                    url,
                    entry,
                    seg,
                    global_limit,
                    active,
                    seg_count,
                    referrer,
                )
                .await
            }));
        }

        let mut unsupported = false;
        let mut failed: Option<String> = None;
        for h in handles {
            match h.await {
                Ok(Ok(())) => {}
                Ok(Err(AttemptError::Aborted)) => {}
                Ok(Err(AttemptError::Unsupported)) => unsupported = true,
                // A 416 on a ranged GET means the server rejected the range
                // (usually a misreported size or a host that doesn't truly honor
                // ranges). Treat it like unsupported ranges and fall back to a
                // single stream, which is robust against that.
                Ok(Err(AttemptError::RangeInvalid)) => unsupported = true,
                Ok(Err(AttemptError::Failed(msg))) => {
                    if failed.is_none() {
                        failed = Some(msg);
                    }
                }
                Err(_) => {
                    if failed.is_none() {
                        failed = Some("Segment task panicked".into());
                    }
                }
            }
        }
        finished.store(true, Ordering::SeqCst);
        prog_task.abort();

        let action = entry.action.swap(0, Ordering::SeqCst);
        if action != 0 {
            return match action {
                1 => AttemptOutcome::Paused,
                _ => AttemptOutcome::Cancelled,
            };
        }
        if unsupported {
            return AttemptOutcome::RangeFallback;
        }
        if let Some(msg) = failed {
            return AttemptOutcome::Failed(msg);
        }

        // Every segment finished — verify sizes then concatenate.
        for seg in &segments {
            let p = part_path(&final_path, seg.index);
            if file_len(&p).unwrap_or(0) < seg.expected_len() {
                return AttemptOutcome::Failed("Segmented download did not complete".into());
            }
        }
        let mut out = match open_final_with_retry(&final_path).await {
            Ok(f) => f,
            Err(e) => return AttemptOutcome::Failed(format!("Finalize error: {e}")),
        };
        for seg in &segments {
            // A pause/cancel during finalize should abort the concat cleanly.
            let pending = entry.action.load(Ordering::SeqCst);
            if pending != 0 {
                let _ = fs::remove_file(&final_path);
                return match entry.action.swap(0, Ordering::SeqCst) {
                    1 => AttemptOutcome::Paused,
                    _ => AttemptOutcome::Cancelled,
                };
            }
            let p = part_path(&final_path, seg.index);
            let mut inp = match tokio::fs::File::open(&p).await {
                Ok(f) => f,
                Err(e) => return AttemptOutcome::Failed(format!("Finalize error: {e}")),
            };
            let mut buf = vec![0u8; 1024 * 1024];
            loop {
                let n = match inp.read(&mut buf).await {
                    Ok(n) => n,
                    Err(e) => return AttemptOutcome::Failed(format!("Finalize error: {e}")),
                };
                if n == 0 {
                    break;
                }
                if let Err(e) = out.write_all(&buf[..n]).await {
                    return AttemptOutcome::Failed(format!("Finalize error: {e}"));
                }
            }
        }
        if let Err(e) = out.flush().await {
            return AttemptOutcome::Failed(format!("Finalize error: {e}"));
        }
        for i in 0..seg_count {
            let _ = fs::remove_file(part_path(&final_path, i));
        }
        if let Err(e) = verify_hash(&entry, &final_path) {
            return AttemptOutcome::Failed(e);
        }
        {
            let mut info = entry.info.lock().unwrap();
            info.received = info.total_size.unwrap_or(0);
            info.speed = 0.0;
            info.updated_at = now_millis();
        }
        self.mark_progress(&entry.info.lock().unwrap().id);
        AttemptOutcome::Done
    }

    // --------------------------------------------------------------- helpers

    /// Lowest priority in the queue minus one, so brand-new downloads appear
    /// on top (matching the previous newest-first ordering) while still being
    /// stable across reorders.
    fn next_priority(&self) -> i64 {
        let entries = self.entries.lock().unwrap();
        entries
            .values()
            .map(|e| e.info.lock().unwrap().priority)
            .min()
            .map(|p| p.saturating_sub(1))
            .unwrap_or(0)
    }

    fn notify_complete(&self, entry: &DownloadEntry) {
        use tauri_plugin_notification::NotificationExt;
        let filename = entry.info.lock().unwrap().filename.clone();
        let lang = self.settings.lock().unwrap().language.clone();
        let title = if lang == "fa" {
            "دانلود کامل شد"
        } else {
            "Download complete"
        };
        let _ = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(filename)
            .show();
    }

    fn notify_failed(&self, entry: &DownloadEntry, msg: &str) {
        use tauri_plugin_notification::NotificationExt;
        let filename = entry.info.lock().unwrap().filename.clone();
        let lang = self.settings.lock().unwrap().language.clone();
        let title = if lang == "fa" {
            "دانلود ناموفق بود"
        } else {
            "Download failed"
        };
        let _ = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(format!("{filename} — {msg}"))
            .show();
    }

    /// Store a Retry-After hint from a 429/503 response for the next backoff.
    fn capture_retry_after(&self, entry: &DownloadEntry, resp: &reqwest::Response) {
        let secs = resp
            .headers()
            .get(header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(0);
        entry.retry_after.store(secs, Ordering::SeqCst);
    }

    /// Take the stored Retry-After hint (if any), clearing it.
    fn retry_after_hint(&self, entry: &DownloadEntry) -> Option<Duration> {
        let secs = entry.retry_after.swap(0, Ordering::SeqCst);
        if secs > 0 {
            Some(Duration::from_secs(secs.min(300)))
        } else {
            None
        }
    }

    fn effective_limit(&self, speed_limit: u64) -> u64 {
        let settings = self.settings.lock().unwrap();
        let g = settings.global_speed_limit;
        drop(settings);
        let active = self.active.load(Ordering::SeqCst).max(1) as u64;
        if speed_limit > 0 && g > 0 {
            speed_limit.min(g / active)
        } else if speed_limit > 0 {
            speed_limit
        } else if g > 0 {
            g / active
        } else {
            0
        }
    }

    fn update_speed(&self, entry: &DownloadEntry, received: u64) {
        let mut st = entry.speed_state.lock().unwrap();
        let now = Instant::now();
        let dt = now.duration_since(st.last).as_secs_f64();
        if dt >= 0.05 {
            let instant = (received.saturating_sub(st.last_received)) as f64 / dt.max(1e-9);
            // Time-based exponential moving average: a fixed time constant makes
            // the readout stable regardless of sample spacing, and bursty TCP
            // traffic no longer swings the displayed speed between ~0 and full.
            let alpha = 1.0 - (-dt / SPEED_SMOOTH_TC).exp();
            st.speed = alpha * instant + (1.0 - alpha) * st.speed;
            st.last = now;
            st.last_received = received;
        }
        // Samples arriving too close together keep the last speed instead of
        // flashing to 0, which previously made the readout "come and go".
        let mut info = entry.info.lock().unwrap();
        info.received = received;
        info.speed = st.speed;
        info.updated_at = now_millis();
    }

    /// Live progress reporter for segmented downloads: recompute received
    /// from the per-segment counters and queue a batched emission. No direct
    /// IPC here — the pump coalesces all active downloads into one event.
    fn mark_aggregate(&self, entry: &DownloadEntry) {
        let base: u64 = entry
            .info
            .lock()
            .unwrap()
            .segments
            .iter()
            .map(|s| s.received)
            .sum();
        let mut live = 0u64;
        for c in &entry.seg_recv {
            live += c.load(Ordering::SeqCst);
        }
        self.update_speed(entry, base + live);
        let id = entry.info.lock().unwrap().id.clone();
        self.mark_progress(&id);
    }

    fn finalize_received(&self, entry: &DownloadEntry) {
        let mut info = entry.info.lock().unwrap();
        let path = info.path.clone();
        let mut total = 0u64;
        if info.segments.is_empty() {
            let p = part_path(Path::new(&path), 0);
            total = file_len(&p).unwrap_or(0);
        } else {
            for seg in info.segments.iter_mut() {
                let p = part_path(Path::new(&path), seg.index);
                let rec = file_len(&p).unwrap_or(0).min(seg.expected_len());
                seg.received = rec;
                total += rec;
            }
        }
        info.received = total;
        info.speed = 0.0;
    }

    fn cleanup_parts(&self, entry: &DownloadEntry) {
        let info = entry.info.lock().unwrap();
        let fp = PathBuf::from(&info.path);
        drop(info);
        // Remove every possible partial segment file. The segment list may have
        // been cleared (e.g. on a range fallback) before this runs, so don't rely
        // on its length — sweep all indices up to MAX_SEGMENTS.
        for i in 0..(MAX_SEGMENTS + 1) {
            let _ = fs::remove_file(part_path(&fp, i));
        }
    }
}

async fn download_segment(
    client: Client,
    url: String,
    entry: Arc<DownloadEntry>,
    seg: SegmentInfo,
    global_limit: u64,
    active: usize,
    seg_count: usize,
    referrer: Option<String>,
) -> Result<(), AttemptError> {
    let final_path = PathBuf::from(entry.info.lock().unwrap().path.clone());
    let part = part_path(&final_path, seg.index);
    let start_offset = seg.start + seg.received;
    let cookies = entry.info.lock().unwrap().cookies.clone();

    // A 416 on a valid range is often the host being flaky (e.g. proxies that
    // intermittently reject ranges), so retry the segment a few times before
    // giving up and falling back to a single stream.
    let mut resp = None;
    for attempt in 0..=SEGMENT_416_RETRIES {
        let mut req = client
            .get(&url)
            .header(header::RANGE, format!("bytes={start_offset}-{}", seg.end));
        if let Some(r) = referrer.as_deref() {
            req = req.header(header::REFERER, r);
        }
        if let Some(c) = cookies.as_deref() {
            if !c.is_empty() {
                req = req.header(header::COOKIE, c);
            }
        }
        let r = match req.send().await {
            Ok(r) => r,
            Err(e) => return Err(AttemptError::Failed(e.to_string())),
        };
        let status = r.status();
        if status == StatusCode::RANGE_NOT_SATISFIABLE {
            if attempt < SEGMENT_416_RETRIES {
                tokio::time::sleep(Duration::from_secs(1 << attempt.min(4))).await;
                continue;
            }
            // Genuinely unsatisfiable range: the probe over-reported the size.
            return Err(AttemptError::RangeInvalid);
        }
        resp = Some(r);
        break;
    }
    let resp = match resp {
        Some(r) => r,
        None => return Err(AttemptError::RangeInvalid),
    };
    let status = resp.status();
    let append = if status == StatusCode::PARTIAL_CONTENT {
        true
    } else if status.is_success() {
        // 200 on a ranged request: server doesn't support ranges.
        return Err(AttemptError::Unsupported);
    } else {
        capture_retry_after(&entry, &resp);
        return Err(AttemptError::Failed(format!("HTTP {}", status.as_u16())));
    };
    // Segments only exist because ranges are supported, but the response can
    // still teach us the true total size if the initial probe missed it.
    if status == StatusCode::PARTIAL_CONTENT {
        if let Some(total) = content_range_total(&resp) {
            let mut info = entry.info.lock().unwrap();
            if info.total_size.is_none() {
                info.total_size = Some(total);
            }
        }
    }
    if seg.received == 0 {
        let _ = fs::remove_file(&part);
    }
    let file = match tokio::fs::OpenOptions::new()
        .create(true)
        .append(append)
        .write(true)
        .open(&part)
        .await
    {
        Ok(f) => f,
        Err(e) => return Err(AttemptError::Failed(format!("Cannot write file: {e}"))),
    };
    // Coalesce ~16 KB TCP chunks into larger sequential writes.
    let mut file = tokio::io::BufWriter::with_capacity(WRITE_BUF_SIZE, file);

    let mut stream = resp.bytes_stream();
    let mut chunk_bytes = 0u64;
    let mut limit_instant = Instant::now();
    let mut cur_limit = 0u64; // current effective per-segment limit
    while let Some(chunk) = stream.next().await {
        if entry.action.load(Ordering::SeqCst) != 0 {
            return Err(AttemptError::Aborted);
        }
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => return Err(AttemptError::Failed(e.to_string())),
        };
        let len = chunk.len() as u64;
        if let Err(e) = file.write_all(&chunk).await {
            return Err(AttemptError::Failed(format!("Write error: {e}")));
        }
        chunk_bytes += len;
        if let Some(c) = entry.seg_recv.get(seg.index) {
            c.fetch_add(len, Ordering::SeqCst);
        }
        // Live per-segment limit: read the entry's limit each chunk and split
        // it across segments; restart the throttle window when it changes so
        // the per-download speed editor applies immediately.
        let entry_limit = entry.info.lock().unwrap().speed_limit;
        let per_seg = per_seg_limit(entry_limit, global_limit, active, seg_count);
        if per_seg != cur_limit {
            cur_limit = per_seg;
            chunk_bytes = 0;
            limit_instant = Instant::now();
        }
        if cur_limit > 0 {
            let elapsed = limit_instant.elapsed();
            let target = Duration::from_secs_f64(chunk_bytes as f64 / cur_limit as f64);
            if target > elapsed {
                tokio::time::sleep(target - elapsed).await;
            }
            if entry.action.load(Ordering::SeqCst) != 0 {
                return Err(AttemptError::Aborted);
            }
        }
    }
    let _ = file.flush().await;
    Ok(())
}

// ------------------------------------------------------------------ probing

pub async fn probe_url(
    client: &Client,
    url: &str,
    referrer: Option<&str>,
    cookies: Option<&str>,
    sample: bool,
) -> Result<UrlMeta, String> {
    let mut head_req = client.head(url);
    if let Some(r) = referrer {
        head_req = head_req.header(header::REFERER, r);
    }
    if let Some(c) = cookies {
        if !c.is_empty() {
            head_req = head_req.header(header::COOKIE, c);
        }
    }
    let head = head_req.send().await;
    let mut filename: Option<String> = None;
    let mut content_type = None;
    let mut size: Option<u64> = None;
    let mut supports_ranges = false;

    if let Ok(resp) = head {
        if resp.status().is_success() {
            // Only trust the HEAD size when Content-Length is actually present,
            // and parse it manually: reqwest reports content_length() as 0 for
            // HEAD responses (no body) even when the header exists, which would
            // otherwise skip the ranged-GET size sniff below.
            if resp.headers().contains_key(header::CONTENT_LENGTH) {
                size = header_content_length(&resp);
            }
            supports_ranges = resp
                .headers()
                .get(header::ACCEPT_RANGES)
                .map(|v| v == "bytes")
                .unwrap_or(false);
            filename = parse_content_disposition(resp.headers().get(header::CONTENT_DISPOSITION));
            content_type = resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(String::from);
        }
    }

    // Speed-sampling ranged GET. We pull a small slice of the file both to learn
    // the true size (when HEAD omitted Content-Length) and to measure the live
    // connection throughput so the UI can show an approximate download time
    // before the user commits to the download.
    //
    // Skipped entirely (`sample = false`) when the caller is about to start a
    // real download: the transfer itself measures everything, and the sample
    // only wasted bandwidth and delayed the Start button.
    if !sample {
        return Ok(UrlMeta {
            filename: filename.unwrap_or_else(|| filename_from_url(url)),
            size,
            supports_ranges,
            content_type,
            speed: None,
        });
    }
    let mut speed_req = client
        .get(url)
        .header(header::RANGE, format!("bytes=0-{}", SPEED_SAMPLE_BYTES - 1));
    if let Some(r) = referrer {
        speed_req = speed_req.header(header::REFERER, r);
    }
    if let Some(c) = cookies {
        if !c.is_empty() {
            speed_req = speed_req.header(header::COOKIE, c);
        }
    }
    let speed_resp = speed_req.send().await;
    let mut speed: Option<u64> = None;
    if let Ok(resp) = speed_resp {
        let status = resp.status();
        if size.is_none() {
            if status == StatusCode::PARTIAL_CONTENT {
                supports_ranges = true;
                size = content_range_total(&resp);
            } else if status.is_success() {
                size = if resp.headers().contains_key(header::CONTENT_LENGTH) {
                    header_content_length(&resp)
                } else {
                    None
                };
            } else {
                return Err(format!("HTTP {}", status.as_u16()));
            }
            if filename.is_none() {
                filename =
                    parse_content_disposition(resp.headers().get(header::CONTENT_DISPOSITION));
            }
            if content_type.is_none() {
                content_type = resp
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
            }
        } else if status == StatusCode::PARTIAL_CONTENT {
            supports_ranges = true;
        }

        // Measure throughput by reading up to SPEED_SAMPLE_BYTES of the body and
        // timing it. A tiny/empty body or a near-instant read yields None so we
        // never surface a bogus "infinite" speed. The read is capped at 15s so a
        // very slow host can't hang the probe (and therefore the Start button).
        let sample = async {
            let start = Instant::now();
            let mut read: u64 = 0u64;
            let mut stream = resp.bytes_stream();
            while read < SPEED_SAMPLE_BYTES {
                match stream.next().await {
                    Some(Ok(chunk)) => read += chunk.len() as u64,
                    _ => break,
                }
            }
            (read, start.elapsed())
        };
        if let Ok((read, elapsed)) = tokio::time::timeout(Duration::from_secs(15), sample).await {
            let secs = elapsed.as_secs_f64();
            if read >= 4096 && secs > 0.05 {
                speed = Some((read as f64 / secs) as u64);
            }
        }
    }

    Ok(UrlMeta {
        filename: filename.unwrap_or_else(|| filename_from_url(url)),
        size,
        supports_ranges,
        content_type,
        speed,
    })
}

/// Free-function variant of `DownloadManager::capture_retry_after` for the
/// segment worker, which has no manager handle.
fn capture_retry_after(entry: &DownloadEntry, resp: &reqwest::Response) {
    let secs = resp
        .headers()
        .get(header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(0);
    entry.retry_after.store(secs, Ordering::SeqCst);
}

fn content_range_total(resp: &reqwest::Response) -> Option<u64> {
    resp.headers()
        .get(header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cr| cr.rsplit('/').next().map(|s| s.trim()))
        .and_then(|s| s.parse::<u64>().ok())
}

fn header_content_length(resp: &reqwest::Response) -> Option<u64> {
    resp.headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
}

fn parse_content_disposition(h: Option<&reqwest::header::HeaderValue>) -> Option<String> {
    let h = h?.to_str().ok()?;
    // RFC 5987: filename*=UTF-8''<pct-encoded>
    for part in h.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename*=") {
            let rest = rest.trim().trim_matches('"');
            if let Some(idx) = rest.find("''") {
                let enc = &rest[idx + 2..];
                if let Ok(decoded) = percent_decode_str(enc).decode_utf8() {
                    return Some(sanitize_filename(&decoded));
                }
            }
        }
    }
    for part in h.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename=") {
            let rest = rest.trim().trim_matches('"');
            if !rest.is_empty() {
                return Some(sanitize_filename(rest));
            }
        }
    }
    None
}

fn filename_from_url(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let last = path.rsplit('/').next().unwrap_or("download");
    let decoded = percent_decode_str(last).decode_utf8_lossy().to_string();
    let cleaned = sanitize_filename(&decoded);
    if cleaned.is_empty() {
        "download".into()
    } else {
        cleaned
    }
}

fn sanitize_filename(name: &str) -> String {
    let name = name.trim();
    let name = name.replace(
        [
            '/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0', '\n', '\r',
        ],
        "_",
    );
    let name = name.trim().trim_matches('.');
    if name.is_empty() {
        "download".to_string()
    } else {
        name.to_string()
    }
}

/// Free bytes on the volume containing `dir`, if it can be determined.
#[cfg(windows)]
fn free_space(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = std::ffi::OsStr::new(dir)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut avail: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut avail,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok != 0 {
        Some(avail)
    } else {
        None
    }
}

#[cfg(not(windows))]
fn free_space(_dir: &Path) -> Option<u64> {
    None
}

/// Compact byte count for error messages.
fn fmt_bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut u = 0;
    while v >= 1024.0 && u < UNITS.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    if u == 0 {
        format!("{n} B")
    } else {
        format!("{v:.1} {}", UNITS[u])
    }
}

/// Rename a finished .part file to its final name, retrying briefly in case an
/// antivirus scanner or Explorer has the file locked at that instant.
async fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for i in 0..6u32 {
        match tokio::fs::rename(from, to).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                tokio::time::sleep(Duration::from_millis(150 * (i as u64 + 1))).await;
            }
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "rename failed")))
}

/// Open (create/truncate) the final file with a few retries for the same
/// file-lock reason as rename_with_retry.
async fn open_final_with_retry(path: &Path) -> std::io::Result<tokio::fs::File> {
    let mut last = None;
    for i in 0..6u32 {
        match tokio::fs::File::create(path).await {
            Ok(f) => return Ok(f),
            Err(e) => {
                last = Some(e);
                tokio::time::sleep(Duration::from_millis(150 * (i as u64 + 1))).await;
            }
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "open failed")))
}

/// Effective per-segment speed limit for a running download: the entry's limit
/// (or the global cap divided across active downloads) split across segments.
fn per_seg_limit(entry_limit: u64, global_limit: u64, active: usize, seg_count: usize) -> u64 {
    let active = active.max(1) as u64;
    let eff = if entry_limit > 0 && global_limit > 0 {
        entry_limit.min(global_limit / active)
    } else if entry_limit > 0 {
        entry_limit
    } else if global_limit > 0 {
        global_limit / active
    } else {
        0
    };
    if eff > 0 {
        (eff / seg_count.max(1) as u64).max(1)
    } else {
        0
    }
}

/// Pick a subfolder for `filename` given the category rules. Returns None when
/// no rule matches. A pattern is a comma-separated list of extensions (e.g.
/// "mp4,mkv") or a MIME fragment (e.g. "video/"); `*` matches everything.
fn categorize(
    rules: &[CategoryRule],
    filename: &str,
    content_type: Option<&str>,
) -> Option<String> {
    let ext = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase());
    let ct = content_type.map(|s| s.to_lowercase());
    for rule in rules {
        let folder = rule.folder.trim();
        if folder.is_empty() {
            continue;
        }
        for token in rule.pattern.split(',') {
            let token = token.trim().to_lowercase();
            if token.is_empty() {
                continue;
            }
            if token == "*" {
                return Some(folder.to_string());
            } else if token.contains('/') {
                if let Some(ct) = &ct {
                    if ct.contains(&token) {
                        return Some(folder.to_string());
                    }
                }
            } else {
                let e = token.trim_start_matches('.');
                if let Some(ext) = &ext {
                    if ext == e {
                        return Some(folder.to_string());
                    }
                }
            }
        }
    }
    None
}

/// SHA-256 of a file, read in chunks so large downloads don't load into memory.
fn sha256_of(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut f =
        fs::File::open(path).map_err(|e| format!("Cannot read file for verification: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f
            .read(&mut buf)
            .map_err(|e| format!("Hash read error: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_vec())
}

/// Verify the completed file against `info.hash` (SHA-256, hex). When no hash
/// is set the download is considered verified. A mismatch fails the download.
fn verify_hash(entry: &DownloadEntry, final_path: &Path) -> Result<(), String> {
    let expected = entry.info.lock().unwrap().hash.clone();
    let Some(expected) = expected.filter(|h| !h.trim().is_empty()) else {
        let mut info = entry.info.lock().unwrap();
        info.verified = true;
        return Ok(());
    };
    let actual = sha256_of(final_path)?;
    let actual_hex = actual
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let mut info = entry.info.lock().unwrap();
    if actual_hex.eq_ignore_ascii_case(expected.trim()) {
        info.verified = true;
        Ok(())
    } else {
        Err(format!(
            "Checksum mismatch: expected {}, got {}",
            expected.trim(),
            actual_hex
        ))
    }
}

fn part_path(final_path: &Path, index: usize) -> PathBuf {
    let name = final_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let parent = final_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    if index == 0 {
        parent.join(format!("{name}{PART_EXT}"))
    } else {
        parent.join(format!("{name}.seg{index}{PART_EXT}"))
    }
}

fn part_exists(dir: &Path, filename: &str) -> bool {
    let base = dir.join(filename);
    for i in 0..(MAX_SEGMENTS + 1) {
        if part_path(&base, i).exists() {
            return true;
        }
    }
    false
}

fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let ext = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let mut i = 1;
    loop {
        let candidate = dir.join(format!("{stem} ({i}){ext}"));
        if !candidate.exists() && !part_exists(dir, &format!("{stem} ({i}){ext}")) {
            return candidate;
        }
        i += 1;
    }
}

fn file_len(p: &Path) -> Option<u64> {
    fs::metadata(p).ok().map(|m| m.len())
}

fn received_from_parts(info: &DownloadInfo) -> u64 {
    let fp = PathBuf::from(&info.path);
    if info.segments.is_empty() {
        file_len(&part_path(&fp, 0)).unwrap_or(0)
    } else {
        info.segments
            .iter()
            .map(|s| {
                file_len(&part_path(&fp, s.index))
                    .unwrap_or(0)
                    .min(s.expected_len())
            })
            .sum()
    }
}

fn is_retryable(msg: &str) -> bool {
    if let Some(code) = msg
        .strip_prefix("HTTP ")
        .and_then(|s| s.trim().parse::<u16>().ok())
    {
        return code >= 500 || code == 408 || code == 429;
    }
    let lower = msg.to_lowercase();
    [
        "reqwest",
        "connection",
        "timeout",
        "timed out",
        "temporarily",
        "try again",
        "reset",
        "broken pipe",
        "eof",
        "send request",
    ]
    .iter()
    .any(|k| lower.contains(k))
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::thread;

    /// Serves a file where HEAD omits Content-Length (the reported problem)
    /// but a ranged GET reveals the true size via Content-Range.
    fn serve_no_length_head(total: u64) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
                let mut req = String::new();
                let mut buf = [0u8; 2048];
                loop {
                    match s.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            req.push_str(&String::from_utf8_lossy(&buf[..n]));
                            if req.contains("\r\n\r\n") || req.len() > 4096 {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let resp = if req.starts_with("HEAD") {
                    // HEAD says 200 but carries no Content-Length — common on CDNs.
                    "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n"
                        .to_string()
                } else if req.to_ascii_lowercase().contains("range: bytes=0-") {
                    format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-0/{total}\r\nContent-Length: 1\r\nConnection: close\r\n\r\nX"
                    )
                } else {
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n"
                    )
                };
                let _ = s.write_all(resp.as_bytes());
                let _ = s.flush();
                let _ = s.shutdown(std::net::Shutdown::Both);
            }
        });
        addr
    }

    #[test]
    fn probe_learns_size_when_head_omits_content_length() {
        let addr = serve_no_length_head(12_345);
        let client = Client::new();
        let meta = tauri::async_runtime::block_on(async move {
            probe_url(
                &client,
                &format!("http://{addr}/video.mp4"),
                None,
                None,
                true,
            )
            .await
        })
        .expect("probe should succeed");
        assert_eq!(
            meta.size,
            Some(12_345),
            "size should be learned via ranged GET"
        );
        assert!(meta.supports_ranges);
        assert_eq!(meta.filename, "video.mp4");
    }

    #[test]
    fn probe_uses_head_content_length_when_present() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                let mut buf = [0u8; 2048];
                let _ = s.read(&mut buf);
                let _ = s.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 999\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                );
                let _ = s.flush();
                let _ = s.shutdown(std::net::Shutdown::Both);
            }
        });
        let client = Client::new();
        let meta = tauri::async_runtime::block_on(async move {
            probe_url(&client, &format!("http://{addr}/a.bin"), None, None, true).await
        })
        .expect("probe should succeed");
        assert_eq!(meta.size, Some(999));
        assert!(meta.supports_ranges);
    }
}
