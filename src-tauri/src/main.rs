mod db;
mod models;
mod player;
mod scanner;
mod security;
mod ytdlp;

use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use db::LibraryDb;
use models::{AppSettings, DownloadProgress, ExternalSourceProbe, LibraryRoot, PlaybackSnapshot, ScanSummary, Track, YtDlpStatus};
use player::AudioPlayer;
use reqwest::{blocking::Response, header::{CONTENT_TYPE, LOCATION}};
use security::{canonicalize_existing_file, validate_remote_url};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;
use uuid::Uuid;

struct AppState {
    db: Mutex<LibraryDb>,
    player: Mutex<AudioPlayer>,
    downloads_dir: Mutex<PathBuf>,
    default_downloads_dir: PathBuf,
    /// This machine's OS "Downloads" folder, used as the base for resolving the
    /// downloads dir stored in the (potentially synced) database.
    os_downloads_dir: PathBuf,
    cache_dir: PathBuf,
    data_dir: PathBuf,
    default_data_dir: PathBuf,
    bootstrap_path: PathBuf,
    /// Per-device map of library root id -> absolute path on THIS machine.
    /// Lives in the bootstrap file (NOT the synced database) so each device can
    /// point a synced library root at wherever its copy of the folder lives,
    /// without overwriting the other device's location.
    root_paths: Mutex<HashMap<String, String>>,
    http: reqwest::blocking::Client,
}

/// Tiny config stored OUTSIDE the data dir so the app knows where the data dir
/// is and where each library root lives on THIS machine.
#[derive(Default, Serialize, Deserialize)]
struct Bootstrap {
    data_dir: Option<String>,
    #[serde(default)]
    root_paths: HashMap<String, String>,
}

fn read_bootstrap(path: &Path) -> Bootstrap {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_bootstrap(path: &Path, bootstrap: &Bootstrap) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(bootstrap).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

impl AppState {
    fn downloads_dir(&self) -> PathBuf {
        self.downloads_dir.lock().map(|dir| dir.clone()).unwrap_or_else(|_| self.default_downloads_dir.clone())
    }

    /// Where a library root lives on THIS machine: the per-device override if
    /// set, otherwise the path stored in the (possibly synced) database.
    fn library_root_path(&self, root: &LibraryRoot) -> PathBuf {
        self.root_paths
            .lock()
            .ok()
            .and_then(|map| map.get(&root.id).cloned())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(&root.canonical_path))
    }

    /// Record a per-device library root location and persist it to the
    /// bootstrap file so it survives restarts.
    fn set_library_root_path(&self, root_id: &str, path: &Path) -> CommandResult<()> {
        let mut bootstrap = read_bootstrap(&self.bootstrap_path);
        bootstrap.root_paths.insert(root_id.to_string(), path.to_string_lossy().to_string());
        if let Ok(mut map) = self.root_paths.lock() {
            map.insert(root_id.to_string(), path.to_string_lossy().to_string());
        }
        write_bootstrap(&self.bootstrap_path, &bootstrap)
    }

    /// Resolve a track to an absolute file path on THIS machine.
    ///
    /// Library files resolve as `<this device's root path>/<relative path>`,
    /// and downloaded files as `<this device's downloads dir>/<file name>`, so
    /// a synced database opens the right file even when absolute paths differ.
    /// Older rows without a relative path fall back to their stored absolute
    /// path. Returns None when no path can be determined.
    fn resolve_track_path(&self, track: &Track) -> Option<PathBuf> {
        match track.source_type.as_str() {
            "library_file" => {
                if let (Some(root_id), Some(relative)) = (&track.library_root_id, &track.relative_path) {
                    if let Ok(db) = self.db.lock() {
                        if let Ok(Some(root)) = db.get_library_root(root_id) {
                            return Some(self.library_root_path(&root).join(scanner::relative_to_pathbuf(relative)));
                        }
                    }
                }
                track.canonical_path.clone().or_else(|| track.path.clone()).map(PathBuf::from)
            }
            "downloaded_file" => {
                if let Some(file_name) = &track.file_name {
                    let candidate = self.downloads_dir().join(file_name);
                    if candidate.exists() {
                        return Some(candidate);
                    }
                }
                track.canonical_path.clone().or_else(|| track.path.clone()).map(PathBuf::from)
            }
            _ => track.canonical_path.clone().or_else(|| track.path.clone()).map(PathBuf::from),
        }
    }
}

/// Encode a chosen downloads dir for storage. When it lives inside the OS
/// Downloads folder we store it RELATIVE to that folder (`.` for the folder
/// itself), so a synced database resolves to the right place on another machine
/// where the home/Downloads path differs. Otherwise we store an absolute path.
fn encode_downloads_dir(canonical: &Path, os_downloads: &Path) -> String {
    match canonical.strip_prefix(os_downloads) {
        Ok(relative) if relative.as_os_str().is_empty() => ".".to_string(),
        Ok(relative) => relative.to_string_lossy().to_string(),
        Err(_) => canonical.to_string_lossy().to_string(),
    }
}

/// Resolve a stored downloads dir value back to an absolute path on this machine.
/// Relative values are interpreted against this machine's OS Downloads folder.
fn resolve_downloads_dir(stored: &str, os_downloads: &Path) -> PathBuf {
    let path = Path::new(stored);
    if path.is_absolute() {
        path.to_path_buf()
    } else if stored == "." {
        os_downloads.to_path_buf()
    } else {
        os_downloads.join(path)
    }
}

type CommandResult<T> = Result<T, String>;

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn supported_audio_path(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_lowercase().as_str(), "mp3" | "m4a" | "aac" | "flac" | "ogg" | "wav"))
        .unwrap_or(false)
}

/// Turn an arbitrary string into a safe single path component (no separators or reserved chars).
fn sanitize_component(input: &str) -> String {
    let mut out: String = input
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    // Collapse runs of whitespace and strip leading/trailing dots and spaces.
    out = out.split_whitespace().collect::<Vec<_>>().join(" ");
    out = out.trim_matches('.').trim().to_string();
    if out.chars().count() > 120 {
        out = out.chars().take(120).collect::<String>().trim().to_string();
    }
    if out.is_empty() {
        out = "track".to_string();
    }
    out
}

/// Build "Artist - Title.ext" (or "Title.ext") from track metadata.
fn build_track_filename(title: &str, artist: Option<&str>, extension: &str) -> String {
    let base = match artist.map(str::trim).filter(|value| !value.is_empty()) {
        Some(artist) => format!("{} - {}", sanitize_component(artist), sanitize_component(title)),
        None => sanitize_component(title),
    };
    let ext = extension.trim_start_matches('.');
    if ext.is_empty() {
        base
    } else {
        format!("{base}.{ext}")
    }
}

/// Resolve a non-colliding destination in `dir`, appending " (n)" before the extension if needed.
fn unique_destination(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(file_name);
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("track");
    let ext = path.extension().and_then(|value| value.to_str());
    for n in 2..10_000 {
        let name = match ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(file_name)
}

fn url_extension(url: &Url, fallback: &str) -> String {
    url.path_segments()
        .and_then(|segments| segments.last())
        .and_then(|file_name| file_name.rsplit_once('.').map(|(_, extension)| extension.to_string()))
        .filter(|extension| !extension.is_empty() && extension.len() <= 5)
        .unwrap_or_else(|| fallback.to_string())
}

fn validated_get(client: &reqwest::blocking::Client, url: Url) -> CommandResult<Response> {
    let mut current = url;

    for _ in 0..5 {
        let response = client
            .get(current.clone())
            .send()
            .map_err(|error| format!("Request failed: {error}"))?;

        if !response.status().is_redirection() {
            return Ok(response);
        }

        let location = response
            .headers()
            .get(LOCATION)
            .ok_or_else(|| "Redirect response did not include a location".to_string())?
            .to_str()
            .map_err(|_| "Redirect location was not valid text".to_string())?;
        let next = current
            .join(location)
            .map_err(|error| format!("Redirect target was invalid: {error}"))?;
        current = validate_remote_url(next.as_str())?;
    }

    Err("Too many redirects".to_string())
}

fn ensure_audio_response(response: &Response, label: &str) -> CommandResult<()> {
    let Some(content_type) = response.headers().get(CONTENT_TYPE).and_then(|value| value.to_str().ok()) else {
        return Ok(());
    };
    let content_type = content_type.split(';').next().unwrap_or(content_type).trim().to_ascii_lowercase();
    let accepted = content_type.starts_with("audio/")
        || matches!(
            content_type.as_str(),
            "application/octet-stream" | "application/ogg" | "video/mp4" | "video/ogg"
        );

    if accepted {
        Ok(())
    } else {
        Err(format!(
            "{label} does not look like a direct audio file. Content-Type was '{content_type}'."
        ))
    }
}

fn emit_playback(app: &AppHandle, snapshot: &PlaybackSnapshot) {
    let _ = app.emit("playback-state", snapshot);
}

fn emit_progress(app: &AppHandle, progress: DownloadProgress) {
    let _ = app.emit("download-progress", progress);
}

fn app_settings(state: &AppState) -> AppSettings {
    AppSettings {
        downloads_dir: state.downloads_dir().to_string_lossy().to_string(),
        default_downloads_dir: state.default_downloads_dir.to_string_lossy().to_string(),
        data_dir: state.data_dir.to_string_lossy().to_string(),
        default_data_dir: state.default_data_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn list_tracks(state: State<AppState>) -> CommandResult<Vec<Track>> {
    let db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    db.list_tracks().map_err(|error| error.to_string())
}

#[tauri::command]
fn list_library_roots(state: State<AppState>) -> CommandResult<Vec<LibraryRoot>> {
    let db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    db.list_library_roots().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_app_settings(state: State<AppState>) -> CommandResult<AppSettings> {
    Ok(app_settings(state.inner()))
}

#[tauri::command]
fn set_downloads_dir(path: String, state: State<AppState>) -> CommandResult<AppSettings> {
    let dir = PathBuf::from(path.trim());
    fs::create_dir_all(&dir).map_err(|error| format!("Cannot use that folder: {error}"))?;
    let canonical = fs::canonicalize(&dir).map_err(|error| format!("Cannot read that folder: {error}"))?;
    if !canonical.is_dir() {
        return Err("Selected path is not a folder".to_string());
    }

    {
        let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        let stored = encode_downloads_dir(&canonical, &state.os_downloads_dir);
        db.set_setting("downloads_dir", &stored)
            .map_err(|error| error.to_string())?;
    }
    {
        let mut current = state.downloads_dir.lock().map_err(|_| "Downloads dir lock poisoned".to_string())?;
        *current = canonical;
    }

    Ok(app_settings(state.inner()))
}

#[tauri::command]
fn set_data_dir(path: String, app: AppHandle) -> CommandResult<AppSettings> {
    let new_dir = PathBuf::from(path.trim());
    fs::create_dir_all(&new_dir).map_err(|error| format!("Cannot use that folder: {error}"))?;
    let new_dir = fs::canonicalize(&new_dir).map_err(|error| format!("Cannot read that folder: {error}"))?;
    if !new_dir.is_dir() {
        return Err("Selected path is not a folder".to_string());
    }

    let (current, bootstrap_path, default_data_dir) = {
        let state = app.state::<AppState>();
        (state.data_dir.clone(), state.bootstrap_path.clone(), state.default_data_dir.clone())
    };

    if new_dir == current {
        let state = app.state::<AppState>();
        return Ok(app_settings(state.inner()));
    }

    // Migrate (copy) on a background thread so a large library doesn't freeze the UI.
    let handle = app.clone();
    let target = new_dir.clone();
    std::thread::spawn(move || {
        if let Err(error) = run_data_migration(&handle, &current, &target, &bootstrap_path) {
            emit_progress(
                &handle,
                DownloadProgress::new("data-migration", "migrate", "failed")
                    .title(Some("Move data folder"))
                    .stage("Could not move data folder")
                    .error(error),
            );
        }
    });

    // Report where data WILL live after restart (downloads default under the new base).
    Ok(AppSettings {
        downloads_dir: new_dir.join("downloads").to_string_lossy().to_string(),
        default_downloads_dir: new_dir.join("downloads").to_string_lossy().to_string(),
        data_dir: new_dir.to_string_lossy().to_string(),
        default_data_dir: default_data_dir.to_string_lossy().to_string(),
    })
}

fn run_data_migration(app: &AppHandle, current: &Path, new_dir: &Path, bootstrap_path: &Path) -> CommandResult<()> {
    let job = || DownloadProgress::new("data-migration", "migrate", "processing").title(Some("Move data folder"));
    emit_progress(app, job().stage("Preparing…"));

    let new_db = new_dir.join("library.sqlite3");
    // Only seed the new location from the current one if it isn't already populated
    // (so pointing at an existing synced folder adopts that data instead of clobbering it).
    if !new_db.exists() {
        emit_progress(app, job().stage("Copying library…"));
        for name in ["library.sqlite3", "library.sqlite3-wal", "library.sqlite3-shm"] {
            let from = current.join(name);
            if from.exists() {
                fs::copy(&from, new_dir.join(name)).map_err(|error| format!("Copying {name} failed: {error}"))?;
            }
        }
        emit_progress(app, job().stage("Copying downloads…"));
        copy_dir_all(&current.join("downloads"), &new_dir.join("downloads"))
            .map_err(|error| format!("Copying downloads failed: {error}"))?;
    }

    // Downloads should follow the data dir, so drop any absolute override in the target DB.
    if new_db.exists() {
        if let Ok(connection) = rusqlite::Connection::open(&new_db) {
            let _ = connection.execute("DELETE FROM settings WHERE key = 'downloads_dir'", []);
        }
    }

    let mut bootstrap = read_bootstrap(bootstrap_path);
    bootstrap.data_dir = Some(new_dir.to_string_lossy().to_string());
    write_bootstrap(bootstrap_path, &bootstrap)?;
    emit_progress(
        app,
        DownloadProgress::new("data-migration", "migrate", "complete")
            .title(Some("Move data folder"))
            .stage("Done — restart AmpStack to apply"),
    );
    Ok(())
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

#[tauri::command]
fn add_library_folder(path: String, state: State<AppState>) -> CommandResult<ScanSummary> {
    let canonical = fs::canonicalize(&path).map_err(|error| format!("Cannot read folder: {error}"))?;
    if !canonical.is_dir() {
        return Err("Selected path is not a folder".to_string());
    }

    let root = {
        let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.upsert_library_root(&canonical.to_string_lossy())
            .map_err(|error| error.to_string())?
    };
    // Remember where this root lives on THIS machine so a synced library
    // resolves here even if the database was created on another device.
    state.set_library_root_path(&root.id, &canonical)?;
    let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    scanner::scan_library_root(&mut db, &root, &canonical)
}

#[tauri::command]
fn rescan_library_folder(root_id: String, state: State<AppState>) -> CommandResult<ScanSummary> {
    let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    let root = db
        .get_library_root(&root_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Library folder not found".to_string())?;
    let root_path = state.library_root_path(&root);
    scanner::scan_library_root(&mut db, &root, &root_path)
}

/// Point a synced library root at its location on THIS machine (when the synced
/// database was created on another device with a different absolute path), then
/// rescan so tracks resolve here.
#[tauri::command]
fn relink_library_folder(root_id: String, path: String, state: State<AppState>) -> CommandResult<ScanSummary> {
    let canonical = fs::canonicalize(path.trim()).map_err(|error| format!("Cannot read folder: {error}"))?;
    if !canonical.is_dir() {
        return Err("Selected path is not a folder".to_string());
    }
    state.set_library_root_path(&root_id, &canonical)?;

    let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    let root = db
        .get_library_root(&root_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Library folder not found".to_string())?;
    scanner::scan_library_root(&mut db, &root, &canonical)
}

#[tauri::command]
fn remove_library_folder(root_id: String, state: State<AppState>) -> CommandResult<()> {
    let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    db.remove_library_root(&root_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_track(track_id: String, app: AppHandle, state: State<AppState>) -> CommandResult<()> {
    let track = {
        let db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.get_track(&track_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Track not found".to_string())?
    };

    let playback_update = {
        let mut player = state.player.lock().map_err(|_| "Player lock poisoned".to_string())?;
        let snapshot = player.snapshot();
        if snapshot.track_id.as_deref() == Some(track_id.as_str()) {
            Some(player.clear())
        } else {
            None
        }
    };
    if let Some(snapshot) = playback_update {
        emit_playback(&app, &snapshot);
    }

    if track.source_type == "downloaded_file" {
        if let Some(path) = state.resolve_track_path(&track) {
            if path.starts_with(state.downloads_dir()) && path.exists() {
                fs::remove_file(path).map_err(|error| error.to_string())?;
            }
        }
    }

    let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    db.delete_track(&track_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_favorite(track_id: String, favorite: bool, state: State<AppState>) -> CommandResult<Track> {
    let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    db.set_track_favorite(&track_id, favorite).map_err(|error| error.to_string())?;
    db.get_track(&track_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Track not found".to_string())
}

#[tauri::command]
fn rename_track(track_id: String, title: String, artist: Option<String>, state: State<AppState>) -> CommandResult<Track> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Title cannot be empty".to_string());
    }
    let artist = artist.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());

    let track = {
        let db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.get_track(&track_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Track not found".to_string())?
    };

    {
        let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.update_track_metadata(&track_id, &title, artist.as_deref())
            .map_err(|error| error.to_string())?;
    }

    // For app-downloaded files we also rename the file on disk so it matches the song name.
    if track.source_type == "downloaded_file" {
        if let Some(current) = state.resolve_track_path(&track) {
            let downloads_dir = state.downloads_dir();
            if current.starts_with(&downloads_dir) && current.exists() {
                let extension = current.extension().and_then(|value| value.to_str()).unwrap_or("mp3");
                let file_name = build_track_filename(&title, artist.as_deref(), extension);
                let dest = unique_destination(&downloads_dir, &file_name);
                if dest != current {
                    fs::rename(&current, &dest).map_err(|error| format!("Could not rename file: {error}"))?;
                    let canonical = fs::canonicalize(&dest).map_err(|error| error.to_string())?;
                    let actual_name = canonical
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or(&file_name)
                        .to_string();
                    let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
                    db.relink_track_file(&track_id, &canonical.to_string_lossy(), &actual_name)
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }

    let db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    db.get_track(&track_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Track not found".to_string())
}

#[tauri::command]
fn import_local_files(paths: Vec<String>, state: State<AppState>) -> CommandResult<Vec<Track>> {
    let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    let mut tracks = Vec::new();

    for path in paths {
        let canonical = canonicalize_existing_file(&path)?;
        if !supported_audio_path(&canonical) {
            continue;
        }
        tracks.push(
            db.upsert_local_file_track("local_file", canonical, None, None)
                .map_err(|error| error.to_string())?,
        );
    }

    Ok(tracks)
}

#[tauri::command]
fn add_remote_url(url: String, state: State<AppState>) -> CommandResult<Track> {
    let validated = validate_remote_url(&url)?;
    let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
    db.upsert_remote_track(validated.as_str())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn check_ytdlp() -> YtDlpStatus {
    ytdlp::check_ytdlp()
}

#[tauri::command]
fn probe_external_source(url: String) -> CommandResult<ExternalSourceProbe> {
    ytdlp::probe_external_source(&url)
}

#[tauri::command]
fn download_external_source(url: String, rights_confirmed: bool, app: AppHandle) -> CommandResult<()> {
    let _ = rights_confirmed;
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err("Enter a source URL".to_string());
    }
    let job_id = format!("ext-{}", Uuid::new_v4());

    // Run off the main thread so the UI stays responsive and progress events render.
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = run_external_download(&handle, &job_id, &trimmed) {
            emit_progress(
                &handle,
                DownloadProgress::new(&job_id, "external", "failed").stage("Download failed").error(error),
            );
        }
    });

    Ok(())
}

fn run_external_download(app: &AppHandle, job_id: &str, url: &str) -> CommandResult<()> {
    let state = app.state::<AppState>();

    emit_progress(app, DownloadProgress::new(job_id, "external", "processing").stage("Reading source…"));
    let probe = ytdlp::probe_external_source(url)?;

    emit_progress(
        app,
        DownloadProgress::new(job_id, "external", "processing")
            .title(Some(&probe.title))
            .stage("Downloading & converting…"),
    );

    let downloads_dir = state.downloads_dir();
    let downloaded = ytdlp::download_external_source(url, &downloads_dir, &state.cache_dir)?;

    emit_progress(
        app,
        DownloadProgress::new(job_id, "external", "processing").title(Some(&probe.title)).stage("Saving…"),
    );

    // Rename yt-dlp's temp-named output to a human-readable song filename.
    let extension = downloaded.path.extension().and_then(|value| value.to_str()).unwrap_or("mp3");
    let file_name = build_track_filename(&downloaded.probe.title, downloaded.probe.uploader.as_deref(), extension);
    let dest = unique_destination(&downloads_dir, &file_name);
    let final_path = if dest != downloaded.path {
        fs::rename(&downloaded.path, &dest).map_err(|error| format!("Could not name downloaded file: {error}"))?;
        fs::canonicalize(&dest).map_err(|error| error.to_string())?
    } else {
        downloaded.path
    };

    {
        let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.upsert_downloaded_external_track(
            final_path,
            &downloaded.probe.url,
            &downloaded.probe.title,
            downloaded.probe.uploader.as_deref(),
            downloaded.probe.duration_seconds,
        )
        .map_err(|error| error.to_string())?;
    }

    emit_progress(
        app,
        DownloadProgress::new(job_id, "external", "complete").title(Some(&probe.title)).stage("Done"),
    );
    Ok(())
}

#[tauri::command]
fn download_track(track_id: String, app: AppHandle, state: State<AppState>) -> CommandResult<()> {
    // Validate up front so obvious problems fail fast and synchronously.
    let track = {
        let db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.get_track(&track_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Track not found".to_string())?
    };
    let source_url = track.url.clone().ok_or_else(|| "Track does not have a remote URL".to_string())?;
    validate_remote_url(&source_url)?;

    {
        let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.set_track_download_status(&track_id, Some("downloading"), None)
            .map_err(|error| error.to_string())?;
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = run_track_download(&handle, &track_id, &track) {
            let state = handle.state::<AppState>();
            if let Ok(mut db) = state.db.lock() {
                let _ = db.set_track_download_status(&track_id, Some("failed"), None);
            }
            emit_progress(
                &handle,
                DownloadProgress::new(&track_id, "remote", "failed")
                    .title(Some(&track.title))
                    .stage("Download failed")
                    .error(error),
            );
        }
    });

    Ok(())
}

fn run_track_download(app: &AppHandle, track_id: &str, track: &Track) -> CommandResult<()> {
    let state = app.state::<AppState>();
    let source_url = track.url.clone().ok_or_else(|| "Track does not have a remote URL".to_string())?;
    let validated = validate_remote_url(&source_url)?;

    let downloads_dir = state.downloads_dir();
    fs::create_dir_all(&downloads_dir).map_err(|error| error.to_string())?;
    let extension = url_extension(&validated, "mp3");
    let file_name = build_track_filename(&track.title, track.artist.as_deref(), &extension);
    let final_path = unique_destination(&downloads_dir, &file_name);
    let temp_path = downloads_dir.join(format!("{}.part", Uuid::new_v4()));

    emit_progress(
        app,
        DownloadProgress::new(track_id, "remote", "downloading").title(Some(&track.title)).stage("Connecting…"),
    );

    let mut response = validated_get(&state.http, validated)?;
    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP {}", response.status()));
    }
    ensure_audio_response(&response, "Download URL")?;

    let total = response.content_length();
    let mut file = File::create(&temp_path).map_err(|error| error.to_string())?;
    let mut downloaded = 0_u64;
    let mut buffer = [0_u8; 32 * 1024];
    let mut last_emit = std::time::Instant::now();

    loop {
        let read = response.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|error| error.to_string())?;
        downloaded += read as u64;
        // Throttle UI events to ~20/sec to avoid flooding the webview.
        if last_emit.elapsed().as_millis() >= 50 {
            emit_progress(
                app,
                DownloadProgress::new(track_id, "remote", "downloading")
                    .title(Some(&track.title))
                    .stage("Downloading…")
                    .bytes(downloaded, total),
            );
            last_emit = std::time::Instant::now();
        }
    }
    drop(file);

    fs::rename(&temp_path, &final_path).map_err(|error| error.to_string())?;
    let canonical = fs::canonicalize(&final_path).map_err(|error| error.to_string())?;

    {
        let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.convert_to_downloaded_track(track_id, canonical).map_err(|error| error.to_string())?;
    }

    emit_progress(
        app,
        DownloadProgress::new(track_id, "remote", "complete")
            .title(Some(&track.title))
            .stage("Done")
            .bytes(downloaded, total),
    );
    Ok(())
}

#[tauri::command]
fn load_track(track_id: String, app: AppHandle, state: State<AppState>) -> CommandResult<PlaybackSnapshot> {
    let track = {
        let db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.get_track(&track_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Track not found".to_string())?
    };

    let path = match track.source_type.as_str() {
        "library_file" | "local_file" | "downloaded_file" => state
            .resolve_track_path(&track)
            .ok_or_else(|| "Track has no file path".to_string())?,
        "remote_url" => {
            let url = track.url.clone().ok_or_else(|| "Track has no URL".to_string())?;
            PathBuf::from(cache_remote_track(&url, &track.id, state.inner())?)
        }
        _ => return Err("Unsupported track source".to_string()),
    };

    if !path.exists() {
        let mut db = state.db.lock().map_err(|_| "Database lock poisoned".to_string())?;
        db.set_track_missing(&track.id, true).map_err(|error| error.to_string())?;
        return Err("Track file is missing".to_string());
    }

    let snapshot = {
        let mut player = state.player.lock().map_err(|_| "Player lock poisoned".to_string())?;
        player.load_file(&track.id, &track.title, path)?
    };
    emit_playback(&app, &snapshot);
    Ok(snapshot)
}

fn cache_remote_track(url: &str, track_id: &str, state: &AppState) -> CommandResult<String> {
    let validated = validate_remote_url(url)?;
    fs::create_dir_all(&state.cache_dir).map_err(|error| error.to_string())?;
    let extension = url_extension(&validated, "mp3");
    let cache_path = state.cache_dir.join(format!("{track_id}.{extension}"));

    if cache_path.exists() {
        return Ok(cache_path.to_string_lossy().to_string());
    }

    let mut response = validated_get(&state.http, validated)?;
    if !response.status().is_success() {
        return Err(format!("Remote playback fetch failed with HTTP {}", response.status()));
    }
    ensure_audio_response(&response, "Remote playback URL")?;

    let mut file = File::create(&cache_path).map_err(|error| error.to_string())?;
    std::io::copy(&mut response, &mut file).map_err(|error| error.to_string())?;
    Ok(cache_path.to_string_lossy().to_string())
}

#[tauri::command]
fn play(app: AppHandle, state: State<AppState>) -> CommandResult<PlaybackSnapshot> {
    let snapshot = {
        let mut player = state.player.lock().map_err(|_| "Player lock poisoned".to_string())?;
        player.play()
    };
    emit_playback(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn pause(app: AppHandle, state: State<AppState>) -> CommandResult<PlaybackSnapshot> {
    let snapshot = {
        let mut player = state.player.lock().map_err(|_| "Player lock poisoned".to_string())?;
        player.pause()
    };
    emit_playback(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn stop(app: AppHandle, state: State<AppState>) -> CommandResult<PlaybackSnapshot> {
    let snapshot = {
        let mut player = state.player.lock().map_err(|_| "Player lock poisoned".to_string())?;
        player.stop()
    };
    emit_playback(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn seek(position_seconds: f64, app: AppHandle, state: State<AppState>) -> CommandResult<PlaybackSnapshot> {
    let snapshot = {
        let mut player = state.player.lock().map_err(|_| "Player lock poisoned".to_string())?;
        player.seek(position_seconds)?
    };
    emit_playback(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn set_volume(volume: f32, app: AppHandle, state: State<AppState>) -> CommandResult<PlaybackSnapshot> {
    let snapshot = {
        let mut player = state.player.lock().map_err(|_| "Player lock poisoned".to_string())?;
        player.set_volume(volume.clamp(0.0, 1.0))
    };
    emit_playback(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn get_playback_state(state: State<AppState>) -> CommandResult<PlaybackSnapshot> {
    let mut player = state.player.lock().map_err(|_| "Player lock poisoned".to_string())?;
    Ok(player.snapshot())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let default_data_dir = app
                .path()
                .app_data_dir()
                .expect("Cannot resolve app data directory");
            // Bootstrap config lives in the config dir (NOT the data dir) so it can point
            // the data dir at a synced folder for cross-device use.
            let bootstrap_path = app
                .path()
                .app_config_dir()
                .expect("Cannot resolve app config directory")
                .join("storage.json");

            let bootstrap = read_bootstrap(&bootstrap_path);
            let root_paths = bootstrap.root_paths.clone();
            let data_dir = bootstrap
                .data_dir
                .clone()
                .map(PathBuf::from)
                .filter(|path| path.is_dir())
                .unwrap_or_else(|| default_data_dir.clone());
            fs::create_dir_all(&data_dir).expect("Cannot create data directory");

            let default_downloads_dir = data_dir.join("downloads");
            // This machine's OS Downloads folder is the base for resolving a downloads
            // dir stored relative in the (possibly synced) database. Fall back to the
            // default downloads dir if the OS can't tell us where Downloads is.
            let os_downloads_dir = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| default_downloads_dir.clone());
            let cache_dir = data_dir.join("remote-cache");
            fs::create_dir_all(&default_downloads_dir).expect("Cannot create downloads directory");
            fs::create_dir_all(&cache_dir).expect("Cannot create remote cache directory");

            let db_path = data_dir.join("library.sqlite3");
            let db = LibraryDb::open(db_path).expect("Cannot open library database");

            // Honor a previously chosen downloads directory if it still exists.
            // Stored values may be relative to the OS Downloads folder (see
            // `encode_downloads_dir`) so a synced DB works across machines.
            let downloads_dir = db
                .get_setting("downloads_dir")
                .ok()
                .flatten()
                .map(|stored| resolve_downloads_dir(&stored, &os_downloads_dir))
                .filter(|path| path.is_dir())
                .unwrap_or_else(|| default_downloads_dir.clone());
            fs::create_dir_all(&downloads_dir).ok();

            let player = AudioPlayer::new().expect("Cannot initialize audio output");
            let http = reqwest::blocking::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("AmpStack/0.1")
                .build()
                .expect("Cannot build HTTP client");

            app.manage(AppState {
                db: Mutex::new(db),
                player: Mutex::new(player),
                downloads_dir: Mutex::new(downloads_dir),
                default_downloads_dir,
                os_downloads_dir,
                cache_dir,
                data_dir,
                default_data_dir,
                bootstrap_path,
                root_paths: Mutex::new(root_paths),
                http,
            });

            // Set the window icon at runtime so it shows in the taskbar during
            // `tauri dev` and on Linux WMs that don't read the bundle icons
            // (those only apply once the packaged app is installed).
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(tauri::include_image!("icons/icon.png"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tracks,
            list_library_roots,
            get_app_settings,
            set_downloads_dir,
            set_data_dir,
            restart_app,
            add_library_folder,
            rescan_library_folder,
            relink_library_folder,
            remove_library_folder,
            delete_track,
            set_favorite,
            rename_track,
            import_local_files,
            add_remote_url,
            check_ytdlp,
            probe_external_source,
            download_external_source,
            download_track,
            load_track,
            play,
            pause,
            stop,
            seek,
            set_volume,
            get_playback_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running AmpStack");
}
