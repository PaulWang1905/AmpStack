use std::{collections::HashSet, fs, path::{Path, PathBuf}};

use walkdir::WalkDir;

use crate::{
    db::LibraryDb,
    models::{LibraryRoot, ScanSummary},
    security::path_inside_root,
    supported_audio_path,
};

/// Turn a path relative to the library root into a portable, `/`-separated
/// string so a synced database resolves to the right file on any OS.
fn portable_relative(canonical: &Path, root_path: &Path) -> Option<String> {
    let relative = canonical.strip_prefix(root_path).ok()?;
    let parts: Vec<String> = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect();
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

/// Scan a library root that lives at `root_path` on THIS machine. The path is
/// resolved per-device by the caller (see `AppState::library_root_path`) so a
/// synced database works even when the absolute path differs across machines.
pub fn scan_library_root(
    db: &mut LibraryDb,
    root: &LibraryRoot,
    root_path: &Path,
) -> Result<ScanSummary, String> {
    if !root_path.exists() || !root_path.is_dir() {
        return Err("Library folder is missing".to_string());
    }

    db.mark_root_tracks_missing(&root.id)
        .map_err(|error| error.to_string())?;

    let mut scanned = 0;
    let mut added = 0;
    let mut updated = 0;
    let mut unsupported = 0;
    let mut seen = HashSet::new();

    for entry in WalkDir::new(root_path).follow_links(false).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        if !supported_audio_path(path) {
            unsupported += 1;
            continue;
        }

        scanned += 1;
        let canonical = match fs::canonicalize(path) {
            Ok(value) => value,
            Err(_) => continue,
        };

        if !path_inside_root(&canonical, root_path) || !seen.insert(canonical.clone()) {
            continue;
        }

        let relative = portable_relative(&canonical, root_path);
        let existed = match relative.as_deref() {
            Some(rel) => db
                .track_exists_by_root_relative(&root.id, rel)
                .map_err(|error| error.to_string())?,
            None => db
                .track_exists_by_canonical_path(canonical.to_string_lossy().as_ref())
                .map_err(|error| error.to_string())?,
        };

        db.upsert_local_file_track("library_file", canonical, relative.as_deref(), Some(&root.id))
            .map_err(|error| error.to_string())?;

        if existed {
            updated += 1;
        } else {
            added += 1;
        }
    }

    db.touch_library_root_scanned(&root.id)
        .map_err(|error| error.to_string())?;

    let missing = db
        .list_tracks()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|track| track.library_root_id.as_deref() == Some(&root.id) && track.missing)
        .count();

    Ok(ScanSummary {
        root_id: root.id.clone(),
        scanned,
        added,
        updated,
        missing,
        unsupported,
    })
}

// Re-export so callers building a resolved path from a stored relative string
// share the same separator convention.
pub fn relative_to_pathbuf(relative: &str) -> PathBuf {
    relative.split('/').collect()
}
