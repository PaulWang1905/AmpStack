use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    pub id: String,
    pub path: String,
    pub canonical_path: String,
    pub added_at: String,
    pub last_scanned_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub source_type: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub path: Option<String>,
    pub canonical_path: Option<String>,
    pub url: Option<String>,
    pub file_name: Option<String>,
    pub extension: Option<String>,
    pub duration_seconds: Option<f64>,
    pub missing: bool,
    pub unsupported: bool,
    pub library_root_id: Option<String>,
    pub download_status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub favorite: bool,
    /// Path relative to the track's anchor (library root for library files),
    /// stored with `/` separators so a synced DB resolves across machines.
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub downloads_dir: String,
    pub default_downloads_dir: String,
    pub data_dir: String,
    pub default_data_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub root_id: String,
    pub scanned: usize,
    pub added: usize,
    pub updated: usize,
    pub missing: usize,
    pub unsupported: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    pub status: String,
    pub track_id: Option<String>,
    pub title: Option<String>,
    pub position_seconds: f64,
    pub duration_seconds: Option<f64>,
    pub volume: f32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// Track id for direct downloads, or a temporary job id for external downloads.
    pub id: String,
    /// "remote" (direct URL) or "external" (yt-dlp).
    pub kind: String,
    pub title: Option<String>,
    pub status: String,
    /// Human-readable description of the current step.
    pub stage: Option<String>,
    pub progress_bytes: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<String>,
}

impl DownloadProgress {
    pub fn new(id: &str, kind: &str, status: &str) -> Self {
        Self {
            id: id.to_string(),
            kind: kind.to_string(),
            title: None,
            status: status.to_string(),
            stage: None,
            progress_bytes: 0,
            total_bytes: None,
            error: None,
        }
    }

    pub fn title(mut self, title: Option<&str>) -> Self {
        self.title = title.map(str::to_string);
        self
    }

    pub fn stage(mut self, stage: &str) -> Self {
        self.stage = Some(stage.to_string());
        self
    }

    pub fn bytes(mut self, progress: u64, total: Option<u64>) -> Self {
        self.progress_bytes = progress;
        self.total_bytes = total;
        self
    }

    pub fn error(mut self, error: String) -> Self {
        self.error = Some(error);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YtDlpStatus {
    pub available: bool,
    pub path: String,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSourceProbe {
    pub url: String,
    pub webpage_url: Option<String>,
    pub title: String,
    pub extractor: Option<String>,
    pub extractor_key: Option<String>,
    pub uploader: Option<String>,
    pub license: Option<String>,
    pub duration_seconds: Option<f64>,
}
