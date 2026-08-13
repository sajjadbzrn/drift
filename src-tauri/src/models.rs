use serde::{Deserialize, Serialize};

/// Current status of a download.
pub mod status {
    pub const QUEUED: &str = "queued";
    pub const DOWNLOADING: &str = "downloading";
    pub const RETRYING: &str = "retrying";
    pub const PAUSED: &str = "paused";
    pub const COMPLETED: &str = "completed";
    pub const FAILED: &str = "failed";
    pub const CANCELLED: &str = "cancelled";
}

/// A rule that routes a download into a subfolder based on its file extension
/// or MIME type. `pattern` is a comma-separated list of extensions (e.g.
/// "mp4,mkv") or a MIME fragment (e.g. "video/"). `folder` is the subfolder
/// (relative to the chosen save dir) the file is written into.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRule {
    pub pattern: String,
    pub folder: String,
}

impl Default for CategoryRule {
    fn default() -> Self {
        Self {
            pattern: String::new(),
            folder: String::new(),
        }
    }
}

fn default_category_rules() -> Vec<CategoryRule> {
    let raw: &[(&str, &str)] = &[
        ("mp4,mkv,avi,mov,webm,flv", "Videos"),
        ("mp3,wav,flac,ogg,m4a,aac", "Music"),
        ("jpg,jpeg,png,gif,webp,svg,bmp,heic", "Images"),
        ("zip,rar,7z,tar,gz,bz2,xz", "Archives"),
        ("pdf,doc,docx,xls,xlsx,ppt,pptx,txt,epub,mobi", "Documents"),
        ("exe,msi,dmg,appimage,apk", "Apps"),
        ("iso,img,dmg.bin", "Disk Images"),
    ];
    raw.iter()
        .map(|(p, f)| CategoryRule {
            pattern: p.to_string(),
            folder: f.to_string(),
        })
        .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentInfo {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub received: u64,
}

impl SegmentInfo {
    pub fn expected_len(&self) -> u64 {
        self.end.saturating_sub(self.start) + 1
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadInfo {
    pub id: String,
    pub url: String,
    /// Referer header sent with the requests (set when the download was
    /// handed over from the browser extension, for hotlink-protected files).
    #[serde(default)]
    pub referrer: Option<String>,
    /// Cookie header value to send with the requests (forwarded by the
    /// browser extension for login-protected sites).
    #[serde(default)]
    pub cookies: Option<String>,
    pub filename: String,
    pub dir: String,
    pub path: String,
    pub total_size: Option<u64>,
    pub received: u64,
    pub status: String,
    pub speed: f64,
    pub error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub segments: Vec<SegmentInfo>,
    pub segmented: bool,
    pub supports_ranges: bool,
    pub retries: u32,
    pub speed_limit: u64,
    /// Expected SHA-256 (lowercase hex). When set, the completed file is
    /// verified against it; a mismatch marks the download failed.
    #[serde(default)]
    pub hash: Option<String>,
    /// True once the completed file matched `hash` (or when no hash was set).
    #[serde(default)]
    pub verified: bool,
    /// Per-download proxy override (e.g. "socks5://127.0.0.1:1080"). Empty =
    /// use the global proxy setting.
    #[serde(default)]
    pub proxy: Option<String>,
    pub completed_at: Option<u64>,
    /// Queue position: lower value = closer to the front. Reassigned 0..n-1
    /// by reorder; new downloads get the lowest value minus one so they land
    /// on top. Defaults to 0 for entries saved by older versions.
    #[serde(default)]
    pub priority: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// "system" | "dark" | "light"
    pub theme: String,
    /// bytes/second, 0 = unlimited
    pub global_speed_limit: u64,
    /// default per-download limit, 0 = unlimited
    pub default_speed_limit: u64,
    pub max_concurrent: usize,
    pub segmented: bool,
    pub auto_retry: bool,
    pub max_retries: u32,
    pub delete_with_remove: bool,
    pub last_save_dir: Option<String>,
    /// Skip the save dialog and write straight into the chosen folder.
    #[serde(default)]
    pub auto_save: bool,
    /// Hiding the window keeps downloads running; quit from the tray to exit.
    #[serde(default)]
    pub close_to_tray: bool,
    /// UI language: "en" | "fa". Defaults to English.
    #[serde(default)]
    pub language: String,
    /// Chrome extension IDs allowed to talk to drift's native messaging host.
    /// Firefox is always allowed via the extension's fixed gecko id.
    #[serde(default)]
    pub chrome_ext_ids: Vec<String>,
    /// Custom User-Agent sent with download/probe requests. Empty = the
    /// built-in "drift/<version>" agent. Some sites block unknown agents.
    #[serde(default)]
    pub user_agent: String,
    /// Proxy mode: "system" (use OS/env proxy), "none" (no proxy), or
    /// "custom" (use `proxy_url`). Empty = "system".
    #[serde(default)]
    pub proxy_mode: String,
    /// Custom proxy URL used when `proxy_mode` is "custom".
    #[serde(default)]
    pub proxy_url: String,
    /// Route downloads into per-type subfolders using `category_rules`.
    #[serde(default)]
    pub auto_categorize: bool,
    /// Rules that map extensions/MIME types to subfolders.
    #[serde(default)]
    pub category_rules: Vec<CategoryRule>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            global_speed_limit: 0,
            default_speed_limit: 0,
            max_concurrent: 3,
            segmented: true,
            auto_retry: true,
            max_retries: 3,
            delete_with_remove: true,
            last_save_dir: None,
            auto_save: false,
            close_to_tray: true,
            language: "en".into(),
            chrome_ext_ids: Vec::new(),
            user_agent: String::new(),
            proxy_mode: "system".into(),
            proxy_url: String::new(),
            auto_categorize: false,
            category_rules: default_category_rules(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlMeta {
    pub filename: String,
    pub size: Option<u64>,
    pub supports_ranges: bool,
    pub content_type: Option<String>,
}
