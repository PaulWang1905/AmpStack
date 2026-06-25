use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension, Result};
use uuid::Uuid;

use crate::{
    models::{LibraryRoot, Track},
    now,
};

/// Shared column list so every track query selects the same shape in the same order.
const TRACK_COLUMNS: &str = "id, source_type, title, artist, album, path, canonical_path, url, file_name, \
     extension, duration_seconds, missing, unsupported, library_root_id, download_status, \
     created_at, updated_at, favorite, relative_path";

pub struct LibraryDb {
    connection: Connection,
}

impl LibraryDb {
    pub fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        }

        let connection = Connection::open(path)?;
        let db = Self { connection };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS library_roots (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                canonical_path TEXT NOT NULL UNIQUE,
                added_at TEXT NOT NULL,
                last_scanned_at TEXT
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY,
                source_type TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT,
                album TEXT,
                path TEXT,
                canonical_path TEXT UNIQUE,
                url TEXT UNIQUE,
                file_name TEXT,
                extension TEXT,
                duration_seconds REAL,
                missing INTEGER NOT NULL DEFAULT 0,
                unsupported INTEGER NOT NULL DEFAULT 0,
                library_root_id TEXT,
                download_status TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (library_root_id) REFERENCES library_roots(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, track_id),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                track_id TEXT NOT NULL,
                source_url TEXT NOT NULL,
                target_path TEXT,
                temp_path TEXT,
                status TEXT NOT NULL,
                progress_bytes INTEGER NOT NULL DEFAULT 0,
                total_bytes INTEGER,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_source_type ON tracks(source_type);
            CREATE INDEX IF NOT EXISTS idx_tracks_library_root_id ON tracks(library_root_id);
            "#,
        )?;

        // Additive column migrations; ignore the "duplicate column" error on re-run.
        let _ = self
            .connection
            .execute("ALTER TABLE tracks ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0", []);
        // Path of a local file relative to its anchor (the library root for
        // library files). Stored with `/` separators so a synced database
        // resolves to the right file on another machine where the absolute
        // library-root path differs. NULL for tracks with no portable anchor
        // (ad-hoc imported files, remote URLs).
        let _ = self
            .connection
            .execute("ALTER TABLE tracks ADD COLUMN relative_path TEXT", []);
        // Identity for library files across devices: the same relative path
        // under the same root is the same track, regardless of absolute path.
        let _ = self.connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_root_relpath \
             ON tracks(library_root_id, relative_path) \
             WHERE library_root_id IS NOT NULL AND relative_path IS NOT NULL",
            [],
        );

        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        self.connection
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
            .optional()
    }

    pub fn set_setting(&mut self, key: &str, value: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn list_tracks(&self) -> Result<Vec<Track>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT {TRACK_COLUMNS} FROM tracks ORDER BY missing ASC, lower(title) ASC"
        ))?;

        let rows = statement.query_map([], track_from_row)?;
        rows.collect()
    }

    pub fn get_track(&self, id: &str) -> Result<Option<Track>> {
        self.connection
            .query_row(
                &format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE id = ?1"),
                params![id],
                track_from_row,
            )
            .optional()
    }

    fn get_track_by_url(&self, url: &str) -> Result<Track> {
        self.connection.query_row(
            &format!("SELECT {TRACK_COLUMNS} FROM tracks WHERE url = ?1"),
            params![url],
            track_from_row,
        )
    }

    pub fn track_exists_by_root_relative(&self, root_id: &str, relative_path: &str) -> Result<bool> {
        let id: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM tracks WHERE library_root_id = ?1 AND relative_path = ?2",
                params![root_id, relative_path],
                |row| row.get(0),
            )
            .optional()?;
        Ok(id.is_some())
    }

    pub fn track_exists_by_canonical_path(&self, canonical_path: &str) -> Result<bool> {
        let id: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM tracks WHERE canonical_path = ?1",
                params![canonical_path],
                |row| row.get(0),
            )
            .optional()?;
        Ok(id.is_some())
    }

    pub fn list_library_roots(&self) -> Result<Vec<LibraryRoot>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, path, canonical_path, added_at, last_scanned_at
            FROM library_roots
            ORDER BY lower(path) ASC
            "#,
        )?;

        let rows = statement.query_map([], root_from_row)?;
        rows.collect()
    }

    pub fn get_library_root(&self, id: &str) -> Result<Option<LibraryRoot>> {
        self.connection
            .query_row(
                "SELECT id, path, canonical_path, added_at, last_scanned_at FROM library_roots WHERE id = ?1",
                params![id],
                root_from_row,
            )
            .optional()
    }

    pub fn upsert_library_root(&mut self, canonical_path: &str) -> Result<LibraryRoot> {
        let existing = self
            .connection
            .query_row(
                "SELECT id, path, canonical_path, added_at, last_scanned_at FROM library_roots WHERE canonical_path = ?1",
                params![canonical_path],
                root_from_row,
            )
            .optional()?;

        if let Some(root) = existing {
            return Ok(root);
        }

        let id = Uuid::new_v4().to_string();
        let created = now();
        self.connection.execute(
            "INSERT INTO library_roots (id, path, canonical_path, added_at) VALUES (?1, ?2, ?3, ?4)",
            params![&id, canonical_path, canonical_path, created],
        )?;

        self.get_library_root(&id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn touch_library_root_scanned(&mut self, root_id: &str) -> Result<()> {
        self.connection.execute(
            "UPDATE library_roots SET last_scanned_at = ?1 WHERE id = ?2",
            params![now(), root_id],
        )?;
        Ok(())
    }

    pub fn remove_library_root(&mut self, root_id: &str) -> Result<()> {
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM tracks WHERE source_type = 'library_file' AND library_root_id = ?1", params![root_id])?;
        transaction.execute("DELETE FROM library_roots WHERE id = ?1", params![root_id])?;
        transaction.commit()
    }

    pub fn mark_root_tracks_missing(&mut self, root_id: &str) -> Result<()> {
        self.connection.execute(
            "UPDATE tracks SET missing = 1, updated_at = ?1 WHERE source_type = 'library_file' AND library_root_id = ?2",
            params![now(), root_id],
        )?;
        Ok(())
    }

    pub fn set_track_missing(&mut self, track_id: &str, missing: bool) -> Result<()> {
        self.connection.execute(
            "UPDATE tracks SET missing = ?1, updated_at = ?2 WHERE id = ?3",
            params![if missing { 1 } else { 0 }, now(), track_id],
        )?;
        Ok(())
    }

    pub fn set_track_favorite(&mut self, track_id: &str, favorite: bool) -> Result<()> {
        self.connection.execute(
            "UPDATE tracks SET favorite = ?1, updated_at = ?2 WHERE id = ?3",
            params![if favorite { 1 } else { 0 }, now(), track_id],
        )?;
        Ok(())
    }

    /// Update the editable metadata of a track (title and artist).
    pub fn update_track_metadata(&mut self, track_id: &str, title: &str, artist: Option<&str>) -> Result<()> {
        self.connection.execute(
            "UPDATE tracks SET title = ?1, artist = ?2, updated_at = ?3 WHERE id = ?4",
            params![title, artist, now(), track_id],
        )?;
        Ok(())
    }

    /// Point a track at a new on-disk location after the file was moved/renamed.
    /// Clears the relative path: this is a device-specific absolute relink, not
    /// a portable library-relative one.
    pub fn relink_track_file(&mut self, track_id: &str, canonical_path: &str, file_name: &str) -> Result<()> {
        self.connection.execute(
            "UPDATE tracks SET path = ?1, canonical_path = ?1, relative_path = NULL, file_name = ?2, missing = 0, updated_at = ?3 WHERE id = ?4",
            params![canonical_path, file_name, now(), track_id],
        )?;
        Ok(())
    }

    pub fn set_track_download_status(&mut self, track_id: &str, status: Option<&str>, path: Option<&str>) -> Result<()> {
        self.connection.execute(
            "UPDATE tracks SET download_status = ?1, path = COALESCE(?2, path), updated_at = ?3 WHERE id = ?4",
            params![status, path, now(), track_id],
        )?;
        Ok(())
    }

    pub fn delete_track(&mut self, track_id: &str) -> Result<()> {
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM playlist_tracks WHERE track_id = ?1", params![track_id])?;
        transaction.execute("DELETE FROM downloads WHERE track_id = ?1", params![track_id])?;
        transaction.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
        transaction.commit()
    }

    pub fn upsert_local_file_track(
        &mut self,
        source_type: &str,
        canonical_path: PathBuf,
        relative_path: Option<&str>,
        library_root_id: Option<&str>,
    ) -> Result<Track> {
        let canonical = canonical_path.to_string_lossy().to_string();
        let file_name = canonical_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Unknown")
            .to_string();
        let title = canonical_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(file_name.as_str())
            .to_string();
        let extension = canonical_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_lowercase());

        // A library file's identity is (root, relative path): the same relative
        // path under the same root is the same track on any machine, even when
        // the absolute path differs. Fall back to absolute path for ad-hoc
        // imports that have no portable anchor.
        let existing_id: Option<String> = match (library_root_id, relative_path) {
            (Some(root_id), Some(relative)) => self
                .connection
                .query_row(
                    "SELECT id FROM tracks WHERE library_root_id = ?1 AND relative_path = ?2",
                    params![root_id, relative],
                    |row| row.get(0),
                )
                .optional()?,
            _ => self
                .connection
                .query_row("SELECT id FROM tracks WHERE canonical_path = ?1", params![&canonical], |row| row.get(0))
                .optional()?,
        };

        let timestamp = now();

        match existing_id {
            Some(id) => {
                self.connection.execute(
                    r#"
                    UPDATE tracks SET
                        source_type = CASE
                            WHEN source_type = 'downloaded_file' THEN source_type
                            ELSE ?2
                        END,
                        title = COALESCE(NULLIF(title, ''), ?3),
                        path = ?4,
                        canonical_path = ?4,
                        relative_path = COALESCE(?5, relative_path),
                        file_name = ?6,
                        extension = ?7,
                        missing = 0,
                        unsupported = 0,
                        library_root_id = COALESCE(?8, library_root_id),
                        updated_at = ?9
                    WHERE id = ?1
                    "#,
                    params![&id, source_type, &title, &canonical, relative_path, &file_name, &extension, library_root_id, &timestamp],
                )?;
                self.get_track(&id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
            None => {
                let id = Uuid::new_v4().to_string();
                self.connection.execute(
                    r#"
                    INSERT INTO tracks (
                        id, source_type, title, path, canonical_path, relative_path, file_name,
                        extension, missing, unsupported, library_root_id, created_at, updated_at
                    )
                    VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, 0, 0, ?8, ?9, ?9)
                    "#,
                    params![&id, source_type, &title, &canonical, relative_path, &file_name, &extension, library_root_id, &timestamp],
                )?;
                self.get_track(&id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
            }
        }
    }

    pub fn upsert_remote_track(&mut self, url: &str) -> Result<Track> {
        let title = url
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty())
            .unwrap_or("Remote Track")
            .replace("%20", " ");
        let extension = Path::new(&title)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_lowercase());
        let id = Uuid::new_v4().to_string();
        let timestamp = now();

        self.connection.execute(
            r#"
            INSERT INTO tracks (
                id, source_type, title, url, file_name, extension, missing, unsupported,
                download_status, created_at, updated_at
            )
            VALUES (?1, 'remote_url', ?2, ?3, ?4, ?5, 0, 0, NULL, ?6, ?7)
            ON CONFLICT(url) DO UPDATE SET
                title = tracks.title,
                updated_at = excluded.updated_at
            "#,
            params![&id, &title, url, &title, &extension, &timestamp, &timestamp],
        )?;

        self.get_track_by_url(url)
    }

    pub fn convert_to_downloaded_track(&mut self, track_id: &str, canonical_path: PathBuf) -> Result<Track> {
        let canonical = canonical_path.to_string_lossy().to_string();
        let file_name = canonical_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("downloaded-track")
            .to_string();
        let extension = canonical_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_lowercase());

        self.connection.execute(
            r#"
            UPDATE tracks
            SET source_type = 'downloaded_file',
                path = ?1,
                canonical_path = ?1,
                file_name = ?2,
                extension = ?3,
                missing = 0,
                unsupported = 0,
                download_status = 'complete',
                updated_at = ?4
            WHERE id = ?5
            "#,
            params![canonical, file_name, extension, now(), track_id],
        )?;

        self.get_track(track_id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn upsert_downloaded_external_track(
        &mut self,
        canonical_path: PathBuf,
        source_url: &str,
        title: &str,
        artist: Option<&str>,
        duration_seconds: Option<f64>,
    ) -> Result<Track> {
        let canonical = canonical_path.to_string_lossy().to_string();
        let file_name = canonical_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("downloaded-track")
            .to_string();
        let fallback_title = canonical_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(file_name.as_str())
            .to_string();
        let title = if title.trim().is_empty() { fallback_title } else { title.trim().to_string() };
        let extension = canonical_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_lowercase());
        let timestamp = now();

        let existing_id: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM tracks WHERE url = ?1 OR canonical_path = ?2 LIMIT 1",
                params![source_url, &canonical],
                |row| row.get(0),
            )
            .optional()?;

        let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let exists = self.get_track(&id)?.is_some();

        if exists {
            self.connection.execute(
                r#"
                UPDATE tracks
                SET source_type = 'downloaded_file',
                    title = ?1,
                    artist = ?2,
                    path = ?3,
                    canonical_path = ?3,
                    url = ?4,
                    file_name = ?5,
                    extension = ?6,
                    duration_seconds = ?7,
                    missing = 0,
                    unsupported = 0,
                    download_status = 'complete',
                    updated_at = ?8
                WHERE id = ?9
                "#,
                params![&title, artist, &canonical, source_url, &file_name, &extension, duration_seconds, &timestamp, &id],
            )?;
        } else {
            self.connection.execute(
                r#"
                INSERT INTO tracks (
                    id, source_type, title, artist, path, canonical_path, url, file_name,
                    extension, duration_seconds, missing, unsupported, download_status,
                    created_at, updated_at
                )
                VALUES (?1, 'downloaded_file', ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, 0, 0, 'complete', ?9, ?10)
                "#,
                params![&id, &title, artist, &canonical, source_url, &file_name, &extension, duration_seconds, &timestamp, &timestamp],
            )?;
        }

        self.get_track(&id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
    }
}

fn root_from_row(row: &rusqlite::Row<'_>) -> Result<LibraryRoot> {
    Ok(LibraryRoot {
        id: row.get(0)?,
        path: row.get(1)?,
        canonical_path: row.get(2)?,
        added_at: row.get(3)?,
        last_scanned_at: row.get(4)?,
    })
}

fn track_from_row(row: &rusqlite::Row<'_>) -> Result<Track> {
    let missing: i64 = row.get(11)?;
    let unsupported: i64 = row.get(12)?;
    let favorite: i64 = row.get(17)?;
    Ok(Track {
        id: row.get(0)?,
        source_type: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        path: row.get(5)?,
        canonical_path: row.get(6)?,
        url: row.get(7)?,
        file_name: row.get(8)?,
        extension: row.get(9)?,
        duration_seconds: row.get(10)?,
        missing: missing != 0,
        unsupported: unsupported != 0,
        library_root_id: row.get(13)?,
        download_status: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        favorite: favorite != 0,
        relative_path: row.get(18)?,
    })
}
