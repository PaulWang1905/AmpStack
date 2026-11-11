# AmpStack

AmpStack is a desktop music player for local libraries, individual audio files, direct online audio links, and offline downloads.

The app is built with a React/TypeScript interface inside a Tauri desktop shell. The Rust backend owns the filesystem, SQLite library database, URL validation, downloads, and audio playback.

## Current Status

Version `0.1.6`. The app builds and runs, and tagged releases produce Windows, macOS (Apple Silicon and Intel) and Linux bundles.

What works today:

- recursive music folder scanning, manual rescan, and per-device relinking
- local audio file import
- search, source filters, favorites, and track renaming
- queue with shuffle and repeat, played through Rust-native `rodio`
- direct audio URLs, with offline download to app-managed storage
- optional scoped `yt-dlp` downloads for sources you have rights to
- synced lyrics from LRCLIB, cached locally
- configurable downloads and data directories, with data-dir migration
- a dark "Nocturne" interface with a custom title bar and a full-screen Now Playing view

Frontend regression tests cover queue changes, playback polling, stop/resume, and event listener cleanup. Pushes and pull requests run these tests, the frontend production build, and a Rust compilation check. See [the work log](./docs/WORK_LOG.md) for the current gap list.

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
- Lyrics: LRCLIB, cached in SQLite

## Requirements

Install these before running the app:

- Node.js 20.19+ or 22.12+ (matching Vite's supported versions)
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
  libasound2-dev \
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
~/build_dir/AmpStack/release/bundle/
```

The npm Tauri commands resolve the current user's home directory on each launch,
so this path works for any username. For direct Cargo commands on Linux/macOS,
set `CARGO_TARGET_DIR="$HOME/build_dir/AmpStack"` to use the same directory.

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
2. Click **Add folder** to choose one or more music folders.
3. AmpStack scans supported audio files recursively and stores file references in SQLite.
4. Click a track to load and play it, or open the full-screen Now Playing view for controls and synced lyrics.
5. Use **Import files** to add individual files outside a scanned folder.
6. Paste a direct audio URL into the URL field to save a remote track.
7. Use the download action on a direct remote audio track to save it for offline playback.
8. Use the external-source download row for sources you have rights or permission to download.
9. Favorite, rename, or remove a track from its row actions.
10. Use **Settings** to change the downloads directory or the data directory.

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

Decoding is handled by `rodio`'s Symphonia backend. MP3 gets the most use; the other formats are accepted by the scanner but have had less playback testing.

## Using One Library On Several Devices

AmpStack is built so a single library database can follow you between machines, even though your music folder lives at a different absolute path on each one.

- Library tracks store a portable, `/`-separated path relative to their library root alongside the absolute path.
- Each device keeps its own library-root-to-path map in a small bootstrap file stored *outside* the data directory, so syncing the database never overwrites the other device's locations.
- On a new device, point the data directory at the synced copy in **Settings**, then use the link button next to each library root ("Locate this folder on this device") to say where that folder lives locally. AmpStack rescans and resolves every track as `<this device's root path>/<relative path>`.

Downloaded files resolve against the current device's downloads directory the same way. Rows created before relative paths existed fall back to their stored absolute path.

## Releases

Pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds Windows, macOS (Apple Silicon and Intel) and Linux bundles and publishes a GitHub release with the artifacts attached.

Before tagging, set the version everywhere with:

```bash
node .github/scripts/set-version.mjs 0.1.6
```

CI runs that same script with the pushed tag, so bundle filenames always match the release even if the commit was not bumped.

macOS and Windows bundles are not code-signed, so those platforms show a security warning on first launch.

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
npm test             # Run frontend regression tests
npm run test:watch   # Run tests in watch mode
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
- Lyrics come from LRCLIB and need a network connection on first lookup; results are cached locally afterwards.
- There is no folder watching; use manual rescan after changing files on disk.
- Reading Apple Music, iTunes, Rhythmbox, Spotify, or other platform-specific libraries is out of scope.
- Frontend tests mock Tauri commands; native audio playback still needs desktop smoke testing.

## Documentation

All docs live in [`docs/`](./docs/):

- [Build & run guide](./docs/BUILD.md)
- [Stack design](./docs/STACK_DESIGN.md)
- [Implementation plan](./docs/IMPLEMENTATION_PLAN.md)
- [Work log](./docs/WORK_LOG.md)
