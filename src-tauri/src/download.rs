use crate::models::{status, AppSettings, DownloadInfo, SegmentInfo, UrlMeta};
use futures_util::StreamExt;
use percent_encoding::percent_decode_str;
use reqwest::{header, Client, StatusCode};
use std::collections::HashMap;
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
}

/// Build the shared HTTP client, honoring the configured User-Agent. An empty
/// UA falls back to the built-in `drift/<version>` agent (some servers block
/// unknown agents, so users can override it in Settings → Network).
fn build_client(user_agent: &str) -> Client {
    let ua = if user_agent.trim().is_empty() {
        format!("drift/{}", env!("CARGO_PKG_VERSION"))
    } else {
        user_agent.trim().to_string()
    };
    Client::builder()
        .user_agent(ua)
        .connect_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap_or_default()
}

impl DownloadManager {
    pub fn new(app: AppHandle, settings: AppSettings) -> Self {
        let sem = Arc::new(tokio::sync::Semaphore::new(settings.max_concurrent.max(1)));
        Self {
            app,
            client: Mutex::new(build_client(&settings.user_agent)),
            entries: Mutex::new(HashMap::new()),
            semaphore: Arc::new(Mutex::new(sem)),
            settings: Mutex::new(settings),
            active: AtomicUsize::new(0),
            dirty: AtomicU8::new(0),
        }
    }

    /// Clone of the shared HTTP client (cloning a reqwest client is cheap —
    /// the connection pool is shared). Rebuilt when the User-Agent changes.
    pub fn client(&self) -> Client {
        self.client.lock().unwrap().clone()
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
        if let Ok(json) = serde_json::to_string_pretty(&infos) {
            let _ = fs::write(dir.join("downloads.json"), json);
        }
        let settings = self.settings.lock().unwrap().clone();
        if let Ok(json) = serde_json::to_string_pretty(&settings) {
            let _ = fs::write(dir.join("settings.json"), json);
        }
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
        let info = entry.info.lock().unwrap().clone();
        let _ = self.app.emit("download://progress", info);
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
    ) -> Result<DownloadInfo, String> {
        let url = url.trim().to_string();
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("URL must start with http:// or https://".into());
        }
        let dir = Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        fs::create_dir_all(&dir).map_err(|e| format!("Cannot create folder: {e}"))?;
        let filename = Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .map(sanitize_filename)
            .unwrap_or_else(|| "download".into());

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

        let meta = probe_url(
            &self.client(),
            &url,
            referrer.as_deref(),
            cookies.as_deref(),
        )
        .await?;

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

        let settings = self.settings.lock().unwrap().clone();
        let want_segmented = segmented.unwrap_or(settings.segmented)
            && meta.supports_ranges
            && meta.size.unwrap_or(0) >= SEGMENT_MIN_SIZE;
        let max_seg = MAX_SEGMENTS.min(settings.max_concurrent.max(1) * 2);
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
            completed_at: None,
            priority,
        };
        let entry = Arc::new(DownloadEntry {
            info: Mutex::new(info),
            action: AtomicU8::new(0),
            seg_recv: (0..nseg).map(|_| Arc::new(AtomicU64::new(0))).collect(),
            speed_state: Mutex::new(SpeedState::at(0)),
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
        if cur.user_agent != settings.user_agent {
            *self.client.lock().unwrap() = build_client(&settings.user_agent);
        }
        *cur = settings;
    }

    /// Change a running download's speed limit (bytes/second, 0 = unlimited).
    /// The workers re-read the limit on every chunk, so it applies live.
    pub fn set_speed_limit(&self, id: &str, limit: u64) -> Result<(), String> {
        let entry = self.get(id)?;
        entry.info.lock().unwrap().speed_limit = limit;
        self.persist();
        self.emit_progress(&entry);
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
                        self.emit_progress(&entry);
                        self.persist();
                        let backoff = Duration::from_secs((1u64 << retries.min(5)).min(30));
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
                    self.emit_progress(&entry);
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

        let mut req = self.client().get(&url);
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
        let status = resp.status();
        let (mut received, append) = if status == StatusCode::PARTIAL_CONTENT {
            (start, true)
        } else if status.is_success() {
            (0u64, false)
        } else {
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
            info.received = received;
        }
        if learned.is_some() {
            self.emit_progress(&entry);
        }
        if received == 0 {
            let _ = fs::remove_file(&part);
        }
        // Avoid a fake speed spike on resume: the speed tracker must start
        // from the actual byte offset, not from zero.
        *entry.speed_state.lock().unwrap() = SpeedState::at(received);

        let mut file = match tokio::fs::OpenOptions::new()
            .create(true)
            .append(append)
            .write(true)
            .open(&part)
            .await
        {
            Ok(f) => f,
            Err(e) => return AttemptOutcome::Failed(format!("Cannot write file: {e}")),
        };

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
                self.update_speed(&entry, received);
                self.emit_progress(&entry);
                last_emit = Instant::now();
            }
        }
        let _ = file.flush().await;

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
        {
            let mut info = entry.info.lock().unwrap();
            info.received = received;
            if info.total_size.is_none() {
                info.total_size = total_size;
            }
        }
        self.update_speed(&entry, received);
        self.emit_progress(&entry);
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
                prog_this.emit_aggregate(&prog_entry);
            }
        });

        let seg_count = segments.len();
        let mut handles = Vec::new();
        for seg in &segments {
            let entry = entry.clone();
            let url = url.clone();
            let referrer = referrer.clone();
            let client = self.client();
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
        {
            let mut info = entry.info.lock().unwrap();
            info.received = info.total_size.unwrap_or(0);
            info.speed = 0.0;
            info.updated_at = now_millis();
        }
        self.emit_progress(&entry);
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

    fn emit_aggregate(&self, entry: &DownloadEntry) {
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
        self.emit_progress(entry);
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
        let n = info.segments.len().max(1);
        let fp = PathBuf::from(&info.path);
        drop(info);
        for i in 0..n {
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
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return Err(AttemptError::Failed(e.to_string())),
    };
    let status = resp.status();
    let append = if status == StatusCode::PARTIAL_CONTENT {
        true
    } else if status.is_success() {
        // 200 on a ranged request: server doesn't support ranges.
        return Err(AttemptError::Unsupported);
    } else {
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
    let mut file = match tokio::fs::OpenOptions::new()
        .create(true)
        .append(append)
        .write(true)
        .open(&part)
        .await
    {
        Ok(f) => f,
        Err(e) => return Err(AttemptError::Failed(format!("Cannot write file: {e}"))),
    };

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

    // If the HEAD probe didn't reveal a size (common on many CDNs and file
    // hosts), sniff the real response with a tiny ranged GET so the UI can
    // show total size, remaining bytes, and ETA right away.
    if size.is_none() {
        let mut sniff = client.get(url).header(header::RANGE, "bytes=0-0");
        if let Some(r) = referrer {
            sniff = sniff.header(header::REFERER, r);
        }
        if let Some(c) = cookies {
            if !c.is_empty() {
                sniff = sniff.header(header::COOKIE, c);
            }
        }
        let resp = sniff.send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
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
            filename = parse_content_disposition(resp.headers().get(header::CONTENT_DISPOSITION));
        }
        if content_type.is_none() {
            content_type = resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(String::from);
        }
    }

    Ok(UrlMeta {
        filename: filename.unwrap_or_else(|| filename_from_url(url)),
        size,
        supports_ranges,
        content_type,
    })
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
                } else if req.to_ascii_lowercase().contains("range: bytes=0-0") {
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
            probe_url(&client, &format!("http://{addr}/video.mp4"), None, None).await
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
            probe_url(&client, &format!("http://{addr}/a.bin"), None, None).await
        })
        .expect("probe should succeed");
        assert_eq!(meta.size, Some(999));
        assert!(meta.supports_ranges);
    }
}
