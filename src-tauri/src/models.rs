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
    pub completed_at: Option<u64>,
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
