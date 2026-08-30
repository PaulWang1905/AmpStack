# AmpStack Work Log

Last updated 2026-08-30. Version `0.1.5`, latest tag `v0.1.5`.

## Current Build Status

AmpStack is well past the MVP scaffold this log used to describe. The app builds
and runs locally on Linux, and a cross-platform release workflow builds Windows,
macOS (Apple Silicon and Intel) and Linux bundles from a pushed `v*` tag.

What has *not* happened: there are no automated tests, and no CI job type-checks
or compiles outside of a tagged release. Everything below has been exercised by
hand rather than by a test suite.

## Implemented

### Library

- Add one or more music folders as library roots.
- Recursive scanning with `walkdir`, accepting `mp3`, `m4a`, `aac`, `flac`,
  `ogg`, `wav` (`supported_audio_path` in `src-tauri/src/main.rs`).
- Manual rescan per root, returning a `ScanSummary`
  (scanned / added / updated / missing / unsupported).
- Relink a root to a new location on this machine, then rescan.
- Remove a root; delete a single track.
- Import individual files from outside any root.
- Missing files are marked on rescan and on failed load, and shown as offline.
- Search, source-type filter, favorites, and per-track rename (title + artist).

### Playback

- `rodio` with Symphonia decoding, wrapped in `src-tauri/src/player.rs`.
- Load, play, pause, stop, seek, volume, and a polled/emitted playback state.
- Queue with shuffle and repeat (`off` / `all` / `one`), track-ended handling,
  next/previous — all in `src/store.ts`.

### Remote And Downloads

- Add a direct audio URL as a track; reject non-audio content types before
  decoding.
- Download a remote track to app-managed storage with progress events.
- Optional `yt-dlp` integration for permitted external sources
  (`check_ytdlp`, `probe_external_source`, `download_external_source`),
  with `--no-playlist`, `--ignore-config`, app-managed output paths, a 500 MB
  cap, and a rights-confirmation checkbox in the UI.
- `yt-dlp` is never bundled: it is looked up on `PATH` or at
  `AMPSTACK_YTDLP_PATH`.
- SSRF guard in `src-tauri/src/security.rs` blocks localhost and private ranges.

### Lyrics

- `fetch_lyrics` queries LRCLIB (`https://lrclib.net/api/search`) and caches
  results in a `lyrics_cache` table.
- Synced LRC lines are parsed into timestamped `LyricLine`s and rendered in a
  scrolling lyrics panel; plain lyrics are the fallback.

### Cross-Device Sync

The design that lets one synced library database work on several machines:

- Library tracks store a portable, `/`-separated `relative_path` alongside the
  absolute path (`portable_relative` in `src-tauri/src/scanner.rs`).
- Each device keeps its own library-root-id → absolute-path map in a small
  bootstrap file stored *outside* the data dir, so syncing the database never
  overwrites another device's paths (`AppState::root_paths`).
- `resolve_track_path` resolves library files as
  `<this device's root path>/<relative path>` and downloaded files as
  `<this device's downloads dir>/<file name>`, falling back to the stored
  absolute path for older rows.
- `relink_library_folder` is how a second device points a synced root at its
  own copy of the folder.

### Settings

- Configurable downloads directory and data directory, each with its default
  shown.
- Moving the data dir migrates existing content and reports progress.
- `restart_app` for changes that need a restart.

### UI

The dark "Nocturne" look: warm glass surfaces over a dark ground with a single
gold accent (`#c8954c`), built with Tailwind utility classes in
`src/App.tsx` (~1.5k lines).

- Custom decorationless title bar with its own resize handles
  (`decorations: false` in `tauri.conf.json`).
- Sidebar navigation across three views: library, settings, now playing.
- Full-screen Now Playing view with an equalizer visualisation and a tabbed
  side panel (lyrics / track info).
- Player bar, download toasts, rename dialog.

### Release CI

- `.github/workflows/release.yml` builds on `v*` tag push or manual dispatch.
- Matrix: `windows-latest`, `macos-latest` (aarch64 + x86_64), `ubuntu-22.04`.
- Linux native deps installed in-job; Rust registry and `src-tauri/target/`
  cached per OS.
- `.github/scripts/set-version.mjs` writes the pushed tag's version into
  `package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock` before the
  build, so bundle filenames always match the release.
- `tauri-action` publishes the release directly (not as a draft).

## Schema

Seven SQLite tables in `src-tauri/src/db.rs`: `settings`, `library_roots`,
`tracks`, `playlists`, `playlist_tracks`, `downloads`, `lyrics_cache`, plus
indexes on `tracks(source_type)` and `tracks(library_root_id)`.

Migrations are additive `ALTER TABLE ... ADD COLUMN` attempts whose errors are
ignored (`favorite`, `relative_path`). There is no schema version counter, so
anything beyond adding a nullable column will need a real migration story.

## Known Gaps

- No automated tests of any kind; no CI type-check or `cargo check` outside a
  tagged release build.
- `playlists` / `playlist_tracks` tables exist but no playlist UI is wired up.
- macOS and Windows bundles are unsigned and un-notarized, so users get an
  OS security warning on first launch.
- No updater plugin, so installs do not self-update.
- `csp: null` in `tauri.conf.json` — the webview runs without a content
  security policy.
- No folder watching; library changes need a manual rescan.
- No schema version counter (see above).
- Reading Apple Music / iTunes / Rhythmbox / Spotify libraries remains out of
  scope.

## Possible Next Steps

1. Add a cheap CI job that runs `npm ci && npm run build` (type-check) and
   `cargo check` on push, so breakage surfaces before a release tag.
2. Build the playlist UI on the tables that already exist, or drop the tables.
3. Decide on code signing for macOS/Windows if the builds are going to be
   shared with anyone else.
4. Set a real CSP.
5. Add a schema version counter before the next non-additive schema change.
