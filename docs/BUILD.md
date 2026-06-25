# Building AmpStack

AmpStack is a **Tauri 2 + React + Vite** desktop app with a **Rust** backend
(audio decode/playback, downloads, SQLite). These steps target **Debian 13
(trixie) / GNOME 48**, which is what this project is developed on. Other distros
differ only in the system-package step.

> Note on "GNOME native": Tauri renders the UI inside **WebKitGTK 4.1 (GTK3)** —
> that is by design and is why the build needs the GTK3/WebKit dev headers below.
> It is *not* a libadwaita/GTK4 app (GTK3 and GTK4 cannot share one process).

---

## 0. What you need (and what's already on this machine)

| Dependency | Purpose | Status here |
|---|---|---|
| Rust toolchain (rustup) | compiles the backend | proxies installed, **no default toolchain set** |
| GTK3 / WebKit2GTK 4.1 **-dev** headers | Tauri Linux build | **missing** |
| Node.js ≥ 18 + npm | frontend build | present (v20) |
| `yt-dlp` | external-source downloads | present |
| `ffmpeg` | audio extraction for yt-dlp | present |

So on this box you only need steps **1** and **2**. Steps 3–4 are listed for a
clean machine.

---

## 1. Install the Linux build dependencies (apt)

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libgtk-3-dev \
  libsoup-3.0-dev \
  librsvg2-dev \
  libayatana-appindicator3-dev \
  libssl-dev \
  build-essential \
  pkgconf \
  curl wget file
```

Verify the WebKit headers are now discoverable:

```bash
pkg-config --exists webkit2gtk-4.1 && echo "webkit OK"
```

## 2. Select a Rust toolchain

`rustup`, `cargo`, and `rustc` are installed as proxies but no default toolchain
is chosen yet, so `cargo` errors with *"could not choose a version"*. Fix it once:

```bash
rustup default stable
rustc --version && cargo --version   # should now print versions
```

## 3. Node.js and frontend packages (clean machine only)

Node 20 + npm are already installed here. On a fresh machine install Node ≥ 18,
then from the project root:

```bash
npm install
```

## 4. Runtime tools for downloads (clean machine only)

External-source downloads shell out to `yt-dlp`, which uses `ffmpeg` to extract
audio. Both are already present here. On a clean machine:

```bash
sudo apt install -y ffmpeg
python3 -m pip install --user -U yt-dlp     # or: pipx install yt-dlp
```

`yt-dlp` must be on `PATH`. To point at a specific binary instead, set
`AMPSTACK_YTDLP_PATH=/full/path/to/yt-dlp` before launching.

---

## 5. Run in development

```bash
npm run tauri:dev
```

This starts Vite on `127.0.0.1:1420` and launches the native window with hot
reload for the React frontend. Rust changes trigger a recompile.

First run compiles the whole Rust dependency tree and is slow (several minutes);
later runs are incremental.

## 6. Production build

Build everything configured in `tauri.conf.json` (`bundle.targets: "all"`):

```bash
npm run tauri:build
```

### Build a single package format

Pass `--bundles <type>` through npm (the `--` forwards args to the `tauri`
binary). Valid Linux types: **`deb`**, **`rpm`**, **`appimage`**.

```bash
# Debian / Ubuntu package
npm run tauri:build -- --bundles deb

# Fedora / RHEL / openSUSE package
npm run tauri:build -- --bundles rpm

# Portable AppImage (runs on most distros)
npm run tauri:build -- --bundles appimage
```

Combine formats with a comma:

```bash
npm run tauri:build -- --bundles deb,rpm
```

To compile the binary without packaging anything:

```bash
npm run tauri:build -- --no-bundle
```

### Where the artifacts land

```
src-tauri/target/release/bundle/deb/*.deb
src-tauri/target/release/bundle/rpm/*.rpm
src-tauri/target/release/bundle/appimage/*.AppImage
src-tauri/target/release/ampstack            # the raw binary
```

### Per-format notes

- **deb** — works out of the box on this Debian box; no extra tooling.
- **rpm** — Tauri generates it natively (no `rpmbuild` needed). You build it on
  Debian; you just can't *install* it here without an RPM-based distro.
- **appimage** — on the **first** build Tauri downloads `linuxdeploy` + the
  AppImage runtime, so that build needs network access. Its GTK plugin also
  requires **`librsvg2-dev`** (for the `librsvg-2.0.pc` file) — make sure step 1
  installed it, or the bundle fails with *"Failed to run plugin: gtk"*. To *run*
  the resulting AppImage you need FUSE (`libfuse2t64` on Debian 13), or run it
  extracted with `./AmpStack.AppImage --appimage-extract-and-run`.

> Build on the **oldest** glibc you intend to support — a `.deb`/AppImage built
> on Debian 13 won't necessarily run on much older systems. There's no
> cross-distro magic; build each target on (or for) its baseline.

---

## 7. Frontend-only checks (no Rust)

Useful while iterating on the UI:

```bash
npm run dev        # Vite dev server only (Tauri APIs are no-ops in a browser)
npm run build      # tsc typecheck + Vite production bundle
```

## Troubleshooting

- **`cargo: command not found`** in a restricted shell but present in a normal
  terminal → the toolchain lives at `/usr/bin` via rustup; run step 2.
- **`failed to run custom build command for ... webkit2gtk`** → step 1 headers
  are missing or out of date.
- **AppImage build: `Failed to run plugin: gtk` / `no 'libdir' variable for
  'librsvg-2.0'`** → install the librsvg dev package: `sudo apt install -y
  librsvg2-dev`, then re-run the appimage build. (deb/rpm don't need it.)
- **External download fails immediately** → check `yt-dlp` is on `PATH`
  (`yt-dlp --version`) and `ffmpeg` is installed.
- **Where do app data, library DB, and downloads live?** By default
  `~/.local/share/dev.ampstack.player/` (`library.sqlite3`, `downloads/`,
  `remote-cache/`). Both the **data folder** (for syncing across devices) and the
  **downloads folder** are overridable in-app (Settings). The chosen data-folder
  path is recorded in `~/.config/dev.ampstack.player/storage.json`; delete that
  file to fall back to the default location.
