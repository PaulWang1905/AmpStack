# AmpStack

AmpStack is a desktop music player for local libraries, individual audio files, direct online audio links, and offline downloads.

The app is built with a React/TypeScript interface inside a Tauri desktop shell. The Rust backend owns the filesystem, SQLite library database, URL validation, downloads, and audio playback.

## Current Status

This repository contains the first MVP scaffold:

- React/Vite frontend
- Tailwind CSS styling
- Tauri v2 desktop shell
- Rust command layer
- SQLite library schema
- recursive music folder scanning
- local audio file import
- direct URL track records
- download command scaffold
- optional scoped `yt-dlp` external-source downloads
- single-track removal
- Rust-native playback through `rodio`

The project has had local build attempts, but the latest code still needs a fresh compile/test pass after recent changes. This assistant environment currently does not have `cargo`/`rustc` on PATH, so Rust/Tauri verification cannot be run from here.

## Stack

- Desktop shell: Tauri v2
- Frontend: React, TypeScript, Vite
- Styling: Tailwind CSS via the official Vite plugin
- Frontend state: Zustand
- Icons: lucide-react
- Backend: Rust
- Database: SQLite via `rusqlite`
- Audio playback: `rodio` with Symphonia-backed decoding
- Downloads: `reqwest`
- External-source downloads: optional user-installed `yt-dlp`
- Folder scanning: `walkdir`

## Requirements

Install these before running the app:

- Node.js 20 or newer
- npm
- Rust 1.77 or newer
- Tauri system dependencies for your OS
- Optional: `yt-dlp` on `PATH` for external-source downloads

For Linux, Tauri requires WebKitGTK and related build packages. On Debian/Ubuntu-style systems, the official Tauri docs currently list:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Reference: https://v2.tauri.app/start/prerequisites/

## Install Dependencies

From the project root:

```bash
npm install
```

This installs the frontend packages and the local Tauri CLI package listed in `package.json`.

Tailwind is wired through `@tailwindcss/vite`, so there is no separate PostCSS setup.

## Optional yt-dlp Setup

AmpStack can call an existing `yt-dlp` executable for sources where downloading is legitimate, such as direct media pages, Internet Archive items, Creative Commons hosts, or your own uploads.

AmpStack does not bundle `yt-dlp`. It looks for `yt-dlp` on `PATH` by default. To use a specific binary, set:

```bash
export AMPSTACK_YTDLP_PATH=/absolute/path/to/yt-dlp
```

## Run In Development

Start the full desktop app:

```bash
npm run tauri:dev
```

This starts Vite on `127.0.0.1:1420` and launches the Tauri desktop window.

For frontend-only development:

```bash
npm run dev
```

Frontend-only mode is useful for UI work, but Tauri commands such as folder picking, playback, scanning, and downloads require the full Tauri app.

## Build

Build the production desktop app:

```bash
npm run tauri:build
```

Tauri build artifacts are written under:

```txt
src-tauri/target/release/bundle/
```

Build only the web frontend:

```bash
npm run build
```

The frontend output is written to:

```txt
dist/
```

## App Workflow

1. Launch the desktop app.
2. Click **Add Folder** to choose one or more music folders.
3. AmpStack scans supported audio files recursively and stores file references in SQLite.
4. Click a track to load and play it.
5. Use **Import Files** to add individual files outside a scanned folder.
6. Paste a direct audio URL into the URL field to save a remote track.
7. Use the download action on a direct remote audio track to save it for offline playback.
8. Use the external-source download row for sources you have rights or permission to download.
9. Use the trash action on a track to remove it from AmpStack.

Local files are referenced in place. They are not copied into the app library by default.

Removing a local or library track only removes its AmpStack database entry. It does not delete the original audio file from disk. Removing a downloaded track also deletes the app-managed offline copy stored under AmpStack's data directory.

AmpStack intentionally does not include a clear-all destructive action.

## Supported Audio Files

The scanner accepts:

- MP3
- M4A/AAC
- FLAC
- Ogg
- WAV

MP3 is the first MVP target. Other formats are included in the supported extension list and should be validated during playback testing.

## Project Layout

```txt
src/
  App.tsx        React app shell and UI
  store.ts      Zustand app state
  tauri.ts      frontend wrappers around Tauri commands
  types.ts      shared frontend types
  styles.css    Tailwind import and global base styles

src-tauri/
  src/main.rs      Tauri setup and command handlers
  src/db.rs        SQLite schema and queries
  src/scanner.rs   recursive library scanning
  src/player.rs    rodio playback wrapper
  src/security.rs  path and URL validation
  src/ytdlp.rs     scoped optional yt-dlp integration
  src/models.rs    serializable backend models
```

## Useful Scripts

```bash
npm run dev          # Vite frontend dev server only
npm run build        # Type-check and build frontend
npm run preview      # Preview built frontend
npm run tauri        # Run local Tauri CLI
npm run tauri:dev    # Run desktop app in development
npm run tauri:build  # Build desktop app package
```

## Notes And Caveats

- Remote URL support is intended for direct audio links that the user has permission to stream or download.
- `yt-dlp` support is optional and scoped to sources the user has rights or permission to download.
- AmpStack runs `yt-dlp` with ignored user config, single-item mode, explicit app-managed output paths, and a 500 MB size limit.
- The Rust URL validator blocks localhost and private/internal IP ranges to reduce SSRF risk.
- Folder watching is not part of the MVP; use manual rescan.
- Reading Apple Music, iTunes, Rhythmbox, Spotify, or other platform-specific libraries is out of scope for the MVP.
- Playback and packaging still need to be compiled and tested on a machine with Rust and Tauri system dependencies installed.

## Documentation

All docs live in [`docs/`](./docs/):

- [Build & run guide](./docs/BUILD.md)
- [Stack design](./docs/STACK_DESIGN.md)
- [Implementation plan](./docs/IMPLEMENTATION_PLAN.md)
- [Work log](./docs/WORK_LOG.md)
