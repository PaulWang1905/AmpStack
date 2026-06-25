# Desktop Music Player Implementation Plan

## Read On The Current Stack Design

The stack design is coherent and intentionally Linux-first:

- Tauri gives the app a small native desktop shell.
- React, TypeScript, and Vite keep the interface fast to build.
- Rust owns playback, downloads, URL validation, filesystem access, and SQLite.
- `symphonia` + `rodio` avoid WebView codec and CORS problems.
- SQLite stores metadata, playlists, download state, and preferences.

The main tradeoff is clear: this design is more reliable across Linux desktops, but it is also more engineering work than using `HTMLAudioElement` in the WebView. The project should therefore prove Rust playback early.

## Phase 0: Project Skeleton

Goal: create a runnable desktop app with the final architecture in place.

- Scaffold Tauri + React + TypeScript + Vite.
- Add a basic app layout with player controls, queue area, and library area.
- Add Zustand for frontend state.
- Add Rust command wiring from React to Tauri.
- Add a placeholder command such as `ping_backend`.
- Verify the app starts on Linux.

Exit criteria:

- `npm run tauri dev` opens the desktop app.
- React can call at least one Rust command.

## Phase 1: Rust Playback Spike

Goal: prove that Rust-native playback is viable before building the rest of the app.

- Add `symphonia` for decoding local audio files.
- Add `rodio` for audio output.
- Implement minimal playback commands:
  - `load_local_file`
  - `play`
  - `pause`
  - `stop`
  - `set_volume`
- Emit playback events to the UI:
  - loaded
  - playing
  - paused
  - stopped
  - error
  - track ended
- Test with MP3, M4A/AAC, FLAC, Ogg, and WAV.

Exit criteria:

- A local file can be loaded and played from the React UI.
- The UI receives basic playback state events.
- At least MP3 and M4A/AAC playback are confirmed.

## Phase 2: App Data And SQLite

Goal: create durable local storage before downloads and playlists depend on it.

- Choose the Rust database layer:
  - Prefer `sqlx` if compile-time checked queries are worth the setup.
  - Prefer `rusqlite` if the app should stay simpler.
- Create migrations for:
  - tracks
  - playlists
  - playlist_tracks
  - downloads
  - preferences
- Add Rust commands:
  - `list_tracks`
  - `save_track`
  - `delete_track`
  - `list_playlists`
  - `save_playlist`
- Store downloaded file paths relative to the app data directory where possible.

Exit criteria:

- App restart preserves saved tracks.
- The UI can list and delete stored track records.

## Phase 3: URL Intake And Security Boundary

Goal: safely accept user-supplied audio links.

- Add a URL parser and validator in Rust.
- Allow only `http` and `https`.
- Block localhost, loopback, link-local, private LAN, and internal IP ranges.
- Resolve DNS before fetch and re-check resolved addresses.
- Limit redirects and validate each redirected URL.
- Reject unsupported schemes such as `file`, `ftp`, and custom app protocols.
- Add basic content-type and extension checks for expected audio formats.

Exit criteria:

- Unsafe URLs are rejected by Rust, not only by the UI.
- Redirects cannot bypass the URL rules.

## Phase 4: Remote Streaming

Goal: stream direct audio links through the Rust playback engine.

- Use `reqwest` for HTTP fetching.
- Feed remote bytes into the decoder.
- Support basic buffering.
- Handle network errors cleanly.
- Add metadata fields for remote tracks:
  - source URL
  - title fallback
  - content type
  - duration when known
- Add HTTP range request support for seekable hosts.

Exit criteria:

- A direct MP3 or M4A URL can stream from the UI.
- Playback errors appear in the UI.
- Seeking works for hosts that support range requests.

## Phase 5: Downloads

Goal: download permitted audio links for offline playback.

- Add download states:
  - queued
  - downloading
  - paused
  - complete
  - failed
  - cancelled
- Stream downloads to a temporary file.
- Rename temp files only after successful completion.
- Emit download progress events.
- Save final file metadata in SQLite.
- Add cancellation.
- Add retry.
- Reconcile incomplete downloads on startup.

Exit criteria:

- A direct audio URL can be downloaded and then played offline.
- Failed or cancelled downloads do not appear as complete tracks.

## Phase 6: Player UI MVP

Goal: make the app pleasant enough to use daily.

- Build a focused first-screen app, not a landing page.
- Add link input.
- Add now-playing section.
- Add play, pause, previous, next, seek, volume, shuffle, and repeat controls.
- Add queue.
- Add library list.
- Add download progress indicators.
- Add empty, loading, error, and offline states.
- Add basic keyboard shortcuts.

Exit criteria:

- A user can paste a link, stream it, download it, find it in the library, and play it again later.

## Phase 7: Playlists And Library Management

Goal: make the local library useful.

- Create playlists.
- Add and remove tracks from playlists.
- Reorder playlist tracks.
- Edit track title, artist, album, and artwork URL.
- Delete downloaded files from disk.
- Search library tracks.
- Sort by title, artist, date added, and downloaded status.

Exit criteria:

- Playlists are persisted and usable after app restart.

## Phase 8: Packaging And Quality

Goal: prepare the app for real desktop use.

- Add app icon and metadata.
- Configure Tauri permissions narrowly.
- Add Linux package target first.
- Add Windows and macOS package checks later.
- Add tests for:
  - URL validation
  - download lifecycle
  - database migrations
  - playback command state transitions
- Add smoke testing for packaged app startup.

Exit criteria:

- A packaged Linux build launches and plays a downloaded track.

## Recommended Build Order

1. Skeleton app.
2. Local Rust playback.
3. SQLite.
4. Secure URL validation.
5. Remote streaming.
6. Downloads.
7. MVP UI.
8. Playlists.
9. Packaging.

## First Technical Decisions

Make these decisions before writing much code:

- `sqlx` vs `rusqlite`.
- Exact supported audio formats for version 1.
- Whether remote streaming must support seeking in the MVP.
- Whether downloads can pause/resume in the MVP or only cancel/retry.
- Where downloaded audio files live inside the app data directory.

## MVP Definition

The MVP is complete when the app can:

- Accept a direct audio URL.
- Validate the URL safely.
- Stream it through Rust playback.
- Download it with visible progress.
- Save it to the local library.
- Play the downloaded file offline.
- Persist the library across restarts.

Anything beyond that, such as visualizers, cover art extraction, system tray controls, and cross-device sync, should wait until the MVP is stable.
