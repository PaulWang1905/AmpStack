# AmpStack Work Log

## Current Build Status

AmpStack is not finished as a fully verified working app yet.

The project has a first desktop MVP scaffold. The user has started local Tauri build runs and resolved several Linux native dependency issues, but the latest code still needs another compile/test pass. This assistant environment still does not have `cargo` or `rustc` on PATH, so Rust/Tauri compilation cannot be run from here.

## Completed So Far

### Planning And Documentation

- Created `STACK_DESIGN.md` with the desktop app stack and architecture rationale.
- Created `IMPLEMENTATION_PLAN.md` with the MVP build phases.
- Added local MP3 playback and music library scanning to the intended product plan.
- Created `README.md` with project intro, requirements, run/build instructions, app workflow, and caveats.

### Project Scaffold

- Added a Vite + React + TypeScript frontend scaffold.
- Added a Tauri v2 desktop app scaffold.
- Added package scripts for frontend and Tauri workflows:
  - `npm run dev`
  - `npm run build`
  - `npm run tauri`
  - `npm run tauri:dev`
  - `npm run tauri:build`

### Frontend

- Built the first app UI in `src/App.tsx`.
- Added Zustand state management in `src/store.ts`.
- Added frontend Tauri command wrappers in `src/tauri.ts`.
- Added shared frontend types in `src/types.ts`.
- Converted styling to Tailwind CSS using the official Vite plugin.
- Kept `src/styles.css` as a small Tailwind import and global base-style file.
- Used `lucide-react` icons for controls and actions.

### Rust / Tauri Backend

- Added Tauri command handlers in `src-tauri/src/main.rs`.
- Added SQLite schema and query logic in `src-tauri/src/db.rs`.
- Added recursive music folder scanning in `src-tauri/src/scanner.rs`.
- Added path and remote URL validation in `src-tauri/src/security.rs`.
- Added a `rodio` playback wrapper in `src-tauri/src/player.rs`.
- Added serializable backend models in `src-tauri/src/models.rs`.
- Added Tauri capabilities in `src-tauri/capabilities/default.json`.

### MVP Features Scaffolded

- Add one or more music folders.
- Recursively scan music folders.
- Store discovered tracks in SQLite.
- Import individual local files.
- List and search tracks.
- Filter tracks by source type.
- Load/play/pause/stop/seek/set volume through Rust commands.
- Add direct remote audio URLs.
- Download remote tracks to app-managed storage.
- Display download progress events.
- Download permitted external sources through optional user-installed `yt-dlp`.
- Remove one track from AmpStack.
- Mark missing files after rescan or failed load.
- Reject non-audio direct URLs with a clearer content-type error before decoding.

### Scoped yt-dlp Integration

- Added `src-tauri/src/ytdlp.rs` for optional external-source downloads.
- Added backend commands:
  - `check_ytdlp`
  - `probe_external_source`
  - `download_external_source`
- Kept `yt-dlp` external to the app; AmpStack looks on `PATH` or `AMPSTACK_YTDLP_PATH`.
- Added single-item mode with `--no-playlist`.
- Added ignored user config with `--ignore-config`.
- Added app-managed download/cache paths and a 500 MB size limit.
- Added a rights/permission checkbox before external-source download.
- Stored successful external downloads as existing `downloaded_file` tracks.

### Data Cleanup

- Added a backend `delete_track` command.
- Added a SQLite cleanup helper for deleting one track and its related playlist/download records.
- Added UI trash actions for individual tracks.
- Kept original local/library music files untouched when removing tracks.
- Deleted app-managed downloaded files when their downloaded track is removed.
- Cleared loaded playback state when the current track is removed.
- Removed the all-data cleanup feature at user request because it felt too risky.

### Tailwind Conversion

- Added `tailwindcss`.
- Added `@tailwindcss/vite`.
- Updated `vite.config.ts` to use the Tailwind Vite plugin.
- Refactored the UI away from custom component CSS classes and into Tailwind utility classes.
- Updated documentation to reflect Tailwind as the styling stack.

## Important Constraints Followed

- The assistant did not run `npm install`.
- The assistant did not run build commands.
- The assistant did not start a dev server.
- The assistant did not launch the Tauri app.
- The assistant did not run Rust compilation.

## Recent Local Build Findings

- Linux native packages were missing during Tauri compilation, including DBus, GTK/GDK, ALSA, and WebKitGTK development headers.
- Tauri required an RGBA `src-tauri/icons/icon.png`.
- A local direct-link playback attempt hit a decoder error because the URL content was not a clean direct audio stream.

## Known Gaps

- The latest code has not been type-checked after the data-cleanup and scoped yt-dlp patches.
- The latest Rust backend has not been compiled after the data-cleanup and scoped yt-dlp patches.
- The latest Tauri config has not been validated after the data-cleanup and scoped yt-dlp patches.
- The playback engine has not been tested with real MP3 files.
- Folder scanning has not been tested against a real music library.
- Download behavior has not been tested against a real direct audio URL.
- Optional `yt-dlp` behavior has not been tested against a real permitted external source.
- Packaging has not been tested.
- There may still be compile-time issues that only `npm run build` or `npm run tauri:dev` will reveal.

## Next Recommended Steps

1. Install system requirements:
   - Node.js 20+
   - npm
   - Rust 1.77+
   - Tauri OS dependencies
2. Run `npm install`.
3. Run `npm run build` to type-check and build the frontend.
4. Run `npm run tauri:dev` to compile and launch the desktop app.
5. Fix any TypeScript, Rust, or Tauri config errors revealed by compilation.
6. Test local MP3 import and playback.
7. Test music folder scanning and manual rescan.
8. Test direct URL add/download behavior.
9. Install `yt-dlp` or set `AMPSTACK_YTDLP_PATH`, then test a permitted external source.
10. Package a Linux build with `npm run tauri:build`.

## Do Not Assume Finished Until

- The app launches through Tauri.
- A local MP3 can be imported and played.
- A selected music folder can be scanned.
- Discovered tracks persist after restart.
- Missing files are handled cleanly.
- A direct audio URL can be added and downloaded.
- A permitted external source can be downloaded through `yt-dlp`.
- The packaged Linux build launches.
