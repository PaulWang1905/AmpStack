use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::Value;
use uuid::Uuid;

use crate::models::{ExternalSourceProbe, YtDlpStatus};

pub struct DownloadedExternalSource {
    pub path: PathBuf,
    pub probe: ExternalSourceProbe,
}

pub fn check_ytdlp() -> YtDlpStatus {
    let path = ytdlp_path();
    match Command::new(&path).arg("--version").output() {
        Ok(output) if output.status.success() => YtDlpStatus {
            available: true,
            path,
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            error: None,
        },
        Ok(output) => YtDlpStatus {
            available: false,
            path,
            version: None,
            error: Some(command_error("yt-dlp --version failed", &output)),
        },
        Err(error) => YtDlpStatus {
            available: false,
            path,
            version: None,
            error: Some(format!("Cannot run yt-dlp: {error}")),
        },
    }
}

pub fn probe_external_source(raw_url: &str) -> Result<ExternalSourceProbe, String> {
    let output = Command::new(ytdlp_path())
        .arg("--ignore-config")
        .arg("--no-update")
        .arg("--dump-single-json")
        .arg("--no-playlist")
        .arg("--skip-download")
        .arg("--no-warnings")
        .arg(raw_url)
        .output()
        .map_err(|error| format!("Cannot run yt-dlp: {error}"))?;

    if !output.status.success() {
        return Err(command_error("yt-dlp could not read this source", &output));
    }

    let value: Value = serde_json::from_slice(&output.stdout).map_err(|error| format!("yt-dlp returned invalid JSON: {error}"))?;
    probe_from_value(raw_url, &value)
}

pub fn download_external_source(raw_url: &str, downloads_dir: &Path, cache_dir: &Path) -> Result<DownloadedExternalSource, String> {
    let probe = probe_external_source(raw_url)?;
    fs::create_dir_all(downloads_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(cache_dir).map_err(|error| error.to_string())?;

    let download_id = Uuid::new_v4().to_string();
    let output_template = format!("{download_id}.%(ext)s");
    let output = Command::new(ytdlp_path())
        .arg("--ignore-config")
        .arg("--no-update")
        .arg("--no-playlist")
        .arg("--no-progress")
        .arg("--restrict-filenames")
        .arg("--format")
        .arg("ba/bestaudio/best")
        .arg("--extract-audio")
        .arg("--audio-format")
        .arg("mp3")
        .arg("--audio-quality")
        .arg("0")
        .arg("--max-filesize")
        .arg("500M")
        .arg("--paths")
        .arg(format!("home:{}", downloads_dir.to_string_lossy()))
        .arg("--paths")
        .arg(format!("temp:{}", cache_dir.to_string_lossy()))
        .arg("--output")
        .arg(output_template)
        .arg(&probe.url)
        .output()
        .map_err(|error| format!("Cannot run yt-dlp: {error}"))?;

    if !output.status.success() {
        return Err(command_error("yt-dlp download failed", &output));
    }

    let path = find_downloaded_file(downloads_dir, &download_id)?;
    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let canonical_downloads_dir = fs::canonicalize(downloads_dir).map_err(|error| error.to_string())?;
    if !canonical.starts_with(&canonical_downloads_dir) {
        return Err("yt-dlp wrote outside the AmpStack downloads directory".to_string());
    }

    if !supported_external_audio_path(&canonical) {
        let _ = fs::remove_file(&canonical);
        return Err("The external source did not produce a supported audio file".to_string());
    }

    Ok(DownloadedExternalSource { path: canonical, probe })
}

fn ytdlp_path() -> String {
    env::var("AMPSTACK_YTDLP_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "yt-dlp".to_string())
}

fn probe_from_value(url: &str, value: &Value) -> Result<ExternalSourceProbe, String> {
    Ok(ExternalSourceProbe {
        url: url.to_string(),
        webpage_url: string_field(value, "webpage_url"),
        title: string_field(value, "title").unwrap_or_else(|| "External Source".to_string()),
        extractor: string_field(value, "extractor"),
        extractor_key: string_field(value, "extractor_key"),
        uploader: string_field(value, "uploader"),
        license: string_field(value, "license"),
        duration_seconds: value.get("duration").and_then(|duration| duration.as_f64()),
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
}

fn find_downloaded_file(downloads_dir: &Path, download_id: &str) -> Result<PathBuf, String> {
    let entries = fs::read_dir(downloads_dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let path = entry.map_err(|error| error.to_string())?.path();
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if stem == download_id && path.is_file() {
            return Ok(path);
        }
    }

    Err("yt-dlp completed but AmpStack could not find the downloaded file".to_string())
}

fn supported_external_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "mp3" | "m4a" | "aac" | "flac" | "ogg" | "opus" | "wav" | "webm" | "mp4"
            )
        })
        .unwrap_or(false)
}

fn command_error(label: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stderr.is_empty() {
        format!("{label}: {stderr}")
    } else if !stdout.is_empty() {
        format!("{label}: {stdout}")
    } else {
        format!("{label}: exited with {}", output.status)
    }
}
