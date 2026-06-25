# Desktop Music Player Stack Design

## Goal

Build a desktop music player that can load direct online audio links, download permitted files for offline playback, and manage a local music library.

## Recommended Stack

Use Tauri with a React frontend and a small Rust backend layer.

```txt
Tauri
React
TypeScript
Vite
Zustand
SQLite
Rust-native audio playback (symphonia + rodio)
Rust commands for downloads and filesystem work
```

> **Linux-first note:** This stack deliberately plays audio in Rust rather than through the WebView's `HTMLAudioElement`. On Linux, Tauri's WebKitGTK WebView relies on whatever GStreamer codec plugins the user happens to have installed, so MP3/AAC playback is non-deterministic across distros. Decoding in Rust removes that dependency. See Streaming and Playback Architecture and Key Risks.

## Why This Stack

Tauri gives the app a native desktop shell for Windows, macOS, and Linux while keeping the UI in web technologies. It is usually smaller and lighter than Electron because it uses the operating system's WebView instead of bundling Chromium with the app.

React and TypeScript are a good fit for the player interface: queue, playlists, library views, download progress, search, and playback controls.

Tailwind CSS is used for styling the React interface, with a small global CSS file for base styles only.

Rust is useful because Tauri's native side is Rust. Most of the app can still be TypeScript, but Rust should handle privileged desktop work such as downloads, filesystem access, app data paths, and local database commands.

## Responsibilities

### React / TypeScript

- Render the player UI.
- Manage queue, playlists, and playback controls (as state; actual decoding/output happens in Rust).
- Drive the playback engine through Tauri commands (`play`, `pause`, `seek`, `set_volume`, `load`) and react to playback events (position, track-ended, errors).
- Validate user input shape before sending it to the backend (treat the backend as the real security boundary, not the UI).
- Show download status and library state.

### Rust / Tauri

- Own the audio playback engine: decode with `symphonia` and output through `rodio`/`cpal`, independent of WebView codec support.
- Expose playback commands and emit playback events (current position, end-of-track, errors) to the UI.
- Download audio files from direct, permitted URLs.
- Fetch and feed remote audio into the decoder for streaming, reusing the same validated fetch path as downloads (see Streaming and Playback Architecture).
- Validate and sanitize every URL before fetching it (scheme allowlist, block localhost and private/internal IP ranges to prevent SSRF).
- Save files into the app's data directory.
- Expose safe commands to the frontend.
- Manage filesystem paths without giving the UI broad disk access.
- Store and query track metadata in SQLite.
- Report download progress back to the UI.

### SQLite

- Store tracks, playlists, queue history, download status, and user preferences.
- Keep metadata separate from downloaded audio files.

## Streaming and Playback Architecture

Audio is decoded and played in **Rust**, not in the WebView. The WebView is UI only: it sends commands and renders state. This sidesteps both the Linux WebKitGTK codec problem and the WebView's CORS restrictions in one move, because Rust controls every fetch and decode.

- **Local files.** Read from the app data directory and decode with `symphonia`; output through `rodio`. No WebView involvement.
- **Remote streaming.** Fetch the URL in Rust (`reqwest`) and feed the byte stream into the decoder. Because the fetch happens in Rust, there are no CORS headers to satisfy and you can attach any required headers yourself. Use HTTP range requests so seeking works while streaming.
- **Why not `HTMLAudioElement`.** Pointing `<audio>` at a remote URL is simpler but fails for many hosts (CORS, required headers/cookies) and depends on WebView codec support, which is unreliable on Linux. Rust-native playback avoids both classes of failure.
- **Visualizer/metering.** Native decoding also makes raw PCM available, so a later audio visualizer can tap the decoded samples directly instead of fighting the WebView audio graph.

## Download Lifecycle

Downloads are the messiest part in practice, so define their states up front.

- Track each download with an explicit status (`queued`, `downloading`, `paused`, `complete`, `failed`, `cancelled`) in SQLite.
- Stream response bodies to a temporary file and rename to the final path only on success, so a crash never leaves a half-file masquerading as a complete track.
- Clean up partial files on failure or cancellation, and reconcile orphaned rows on startup.
- Support retry; resume (HTTP range) is a nice-to-have but optional for the MVP.

## Suggested Libraries

- Tauri app shell: `tauri`
- Frontend build: `vite`
- UI framework: `react`
- Language: `typescript`
- Styling: `tailwindcss` through `@tailwindcss/vite`
- State management: `zustand`
- Audio decoding (Rust): `symphonia` (MP3, AAC/M4A, FLAC, Ogg, WAV)
- Audio output (Rust): `rodio` (on `cpal`)
- Local database: `sqlx` or `rusqlite` in Rust commands for typed queries and migrations; the Tauri SQL plugin is fine if queries stay simple
- HTTP downloads (Rust): `reqwest` with streaming response bodies
- Filesystem access: Tauri filesystem/path APIs

## MVP Features

- Paste an audio URL.
- Stream the URL.
- Download a permitted audio file for offline playback.
- Save track metadata locally.
- Play downloaded files.
- Create and edit playlists.
- Queue tracks.
- Shuffle and repeat.
- Show download progress.
- Delete downloaded files.

## Later Features

- Metadata extraction from downloaded files.
- Cover art.
- Import local files and folders.
- Keyboard shortcuts.
- Mini player.
- System tray controls.
- Audio visualizer.
- Cross-device sync through an optional backend.

## Legal And Product Boundary

The app should support direct audio links, local files, podcast feeds, and sources where the user has rights or API permission. It should not be designed around scraping or downloading protected content from services such as Spotify, SoundCloud, or Apple Music unless the implementation uses official APIs and follows their terms.

## Electron Alternative

If a JavaScript-only desktop stack is more important than app size and memory usage, Electron is the simpler alternative:

```txt
Electron
React
TypeScript
Vite
Node.js download logic
SQLite
```

Electron is mature and easy to build with, but it tends to produce larger apps because it bundles Chromium and Node.js.

- **WebView codec support varies by OS** — *mitigated by design.* Linux WebKitGTK supports fewer audio codecs than Chromium and depends on the user's GStreamer plugins, which is why this stack decodes in Rust (`symphonia`) instead of using `HTMLAudioElement`. Keep playback out of the WebView and this risk stays closed. Still verify each target format decodes correctly via `symphonia` early.
- **CORS on remote streaming** — *mitigated by design,* since Rust performs every fetch. The remaining work is robust handling of redirects, auth headers, and content types in the Rust fetch path.
- **Building the playback engine is real work.** Choosing Rust-native audio means you implement play/pause/seek/volume/gapless and a clean event bridge to the UI yourself, rather than getting them from `<audio>`. This is the deliberate cost of reliable Linux playback. If that effort is unacceptable, the Electron path (Chromium + `HTMLAudioElement`) is the fallback.
- **SSRF from user-supplied URLs.** The Rust side fetches arbitrary URLs with desktop privileges; without a scheme allowlist and private-IP blocking, a malicious link could probe internal services.

## Recommendation

Start with Tauri, React, TypeScript, Vite, Tailwind CSS, Zustand, and SQLite, and play audio natively in Rust with `symphonia` (decode) and `rodio` (output). This keeps Tauri's small footprint while giving reliable, codec-independent playback on Linux — the main reason `HTMLAudioElement`/Howler.js is *not* recommended here.

Reconsider Electron only if writing a Rust playback engine is more cost than you want to take on; in that case Chromium's bundled codecs and `HTMLAudioElement` give consistent playback at the price of a larger, heavier app.
