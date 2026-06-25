import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CheckCircle2,
  Disc3,
  Download,
  FolderOpen,
  FolderPlus,
  HardDriveDownload,
  Heart,
  Import,
  Library,
  Link2,
  Loader2,
  Minus,
  Music2,
  Pause,
  Pencil,
  Play,
  RefreshCcw,
  Repeat,
  Repeat1,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Copy,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  X,
  XCircle
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { checkYtDlp, listenDownloadProgress, listenPlayback } from "./tauri";
import { selectActiveDownloads, selectActiveTrack, selectFilteredTracks, useAppStore } from "./store";
import type { Track, YtDlpStatus } from "./types";

function formatSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined || value < 0 || Number.isNaN(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function sourceLabel(track: Track): string {
  if (track.sourceType === "library_file") return "Library";
  if (track.sourceType === "local_file") return "Local";
  if (track.sourceType === "remote_url") return "Stream";
  return "Offline";
}

/** One quiet chip for every source — the label text already says which is
 *  which, so colour would just be noise. */
function sourceBadgeClass(_track: Track): string {
  return "bg-black/[0.05] text-zinc-500";
}

/** Purple range slider whose fill follows the current value. */
function Slider({
  value,
  max,
  step,
  disabled,
  onChange,
  className
}: {
  value: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  return (
    <input
      type="range"
      className={`amp-range w-full ${className ?? ""}`}
      style={{ "--pct": pct } as CSSProperties}
      min={0}
      max={safeMax}
      step={step ?? 1}
      value={Math.min(value, safeMax)}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function AlbumArt({ track, size }: { track?: Track; size: "sm" | "lg" }) {
  const dimension = size === "lg" ? "h-14 w-14" : "h-11 w-11";
  const iconSize = size === "lg" ? "h-7 w-7" : "h-5 w-5";
  return (
    <div
      className={`${dimension} grid shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm ring-1 ring-black/[0.06]`}
    >
      {track ? <Music2 className={iconSize} /> : <Disc3 className={iconSize} />}
    </div>
  );
}

function RenameDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const renameTrack = useAppStore((state) => state.renameTrack);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist ?? "");

  const submit = async () => {
    if (!title.trim()) return;
    await renameTrack(track.id, title.trim(), artist.trim() || null);
    onClose();
  };

  const renamesFile = track.sourceType === "downloaded_file";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong amp-pop w-full max-w-md rounded-2xl border border-black/[0.07] p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit track</h2>
          <button className="rounded-lg p-1 text-zinc-500 hover:bg-black/[0.05] hover:text-zinc-900" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <label className="mb-1 block text-sm text-zinc-500">Title</label>
        <input
          autoFocus
          className="mb-3 w-full rounded-lg border border-black/[0.07] bg-white/60 px-3 py-2 outline-none focus:border-violet-500"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
        />
        <label className="mb-1 block text-sm text-zinc-500">Artist</label>
        <input
          className="mb-2 w-full rounded-lg border border-black/[0.07] bg-white/60 px-3 py-2 outline-none focus:border-violet-500"
          value={artist}
          onChange={(event) => setArtist(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
        />
        {renamesFile && (
          <p className="mb-4 text-xs text-zinc-400">The downloaded file on disk will be renamed to match.</p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button className="rounded-lg px-4 py-2 text-zinc-700 hover:bg-black/[0.05]" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white disabled:opacity-50"
            disabled={!title.trim()}
            onClick={submit}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function TrackRow({ track, onRename }: { track: Track; onRename: (track: Track) => void }) {
  const playback = useAppStore((state) => state.playback);
  const playTrack = useAppStore((state) => state.playTrack);
  const togglePlay = useAppStore((state) => state.togglePlay);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const downloadTrack = useAppStore((state) => state.downloadTrack);
  const deleteTrack = useAppStore((state) => state.deleteTrack);
  const downloads = useAppStore((state) => state.downloads);
  const busy = useAppStore((state) => state.busy);

  const isActive = playback.trackId === track.id;
  const isPlaying = isActive && playback.status === "playing";
  const progress = downloads[track.id];
  const isDownloading = progress?.status === "downloading";
  const downloadPct =
    progress && progress.totalBytes ? Math.round((progress.progressBytes / progress.totalBytes) * 100) : null;

  return (
    <div
      className={[
        "group flex items-center gap-3 rounded-lg px-2 py-1.5 transition",
        isActive ? "bg-violet-600/[0.07]" : "hover:bg-black/[0.04]",
        track.missing ? "opacity-60" : ""
      ].join(" ")}
    >
      <button
        className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl"
        onClick={() => (isActive ? togglePlay() : playTrack(track.id))}
        title={isPlaying ? "Pause" : "Play"}
        type="button"
      >
        <AlbumArt track={track} size="sm" />
        <span
          className={`absolute inset-0 grid place-items-center rounded-xl bg-black/35 text-white transition ${
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {isPlaying ? <Pause className="h-[18px] w-[18px]" /> : <Play className="h-[18px] w-[18px] translate-x-[1px]" />}
        </span>
      </button>

      <button className="grid min-w-0 flex-1 gap-0.5 text-left" onClick={() => playTrack(track.id)} type="button">
        <span className={`truncate text-[0.92rem] font-medium ${isActive ? "text-violet-700" : "text-zinc-900"}`}>
          {track.title}
        </span>
        <span className="truncate text-[0.8rem] text-zinc-500">
          {track.artist ?? "Unknown artist"}
          {track.missing ? " · Missing" : ""}
        </span>
      </button>

      {isDownloading && (
        <span className="text-xs tabular-nums text-violet-600">{downloadPct !== null ? `${downloadPct}%` : "…"}</span>
      )}

      <span className={`hidden rounded-md px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide sm:inline ${sourceBadgeClass(track)}`}>
        {sourceLabel(track)}
      </span>

      <span className="w-10 text-right text-[0.8rem] tabular-nums text-zinc-400">
        {formatSeconds(track.durationSeconds)}
      </span>

      <div className="flex items-center gap-0.5">
        <button
          className={`rounded-lg p-1.5 transition hover:bg-black/[0.05] ${
            track.favorite ? "text-violet-600" : "text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-zinc-800"
          }`}
          onClick={() => toggleFavorite(track.id)}
          title={track.favorite ? "Remove from favorites" : "Add to favorites"}
          type="button"
        >
          <Heart className={track.favorite ? "fill-current" : ""} />
        </button>
        {track.sourceType === "remote_url" && (
          <button
            className="rounded-lg p-1.5 text-zinc-400 opacity-0 transition hover:bg-black/[0.05] hover:text-zinc-800 group-hover:opacity-100 disabled:opacity-40"
            disabled={busy || isDownloading}
            onClick={() => downloadTrack(track.id)}
            title="Download for offline"
            type="button"
          >
            {isDownloading ? <Loader2 className="animate-spin" /> : <HardDriveDownload />}
          </button>
        )}
        <button
          className="rounded-lg p-1.5 text-zinc-400 opacity-0 transition hover:bg-black/[0.05] hover:text-zinc-800 group-hover:opacity-100"
          onClick={() => onRename(track)}
          title="Edit title / artist"
          type="button"
        >
          <Pencil />
        </button>
        <button
          className="rounded-lg p-1.5 text-zinc-400 opacity-0 transition hover:bg-black/[0.05] hover:text-rose-600 group-hover:opacity-100"
          onClick={() => {
            if (window.confirm(`Remove "${track.title}" from AmpStack? Local files stay on disk; app-downloaded copies are deleted.`)) {
              deleteTrack(track.id);
            }
          }}
          title="Remove from library"
          type="button"
        >
          <Trash2 />
        </button>
      </div>
    </div>
  );
}

/** Tracks whether the OS window is maximized, so the title bar can show the
 *  correct maximize/restore control. */
function useIsMaximized() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((off) => off()).catch(() => {});
    };
  }, [appWindow]);

  return maximized;
}

/** Custom window frame: a draggable bar with min / maximize / close controls,
 *  so we get a consistent look instead of the dated GTK title bar on Linux. */
function TitleBar() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const maximized = useIsMaximized();

  const control = "grid h-8 w-12 place-items-center text-zinc-500 transition hover:bg-black/[0.06] hover:text-zinc-900";

  return (
    <div
      data-tauri-drag-region
      className="glass flex h-9 shrink-0 select-none items-center justify-between border-b border-black/[0.06]"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3 text-xs font-medium text-zinc-400">
        <Disc3 className="h-3.5 w-3.5 text-violet-600" />
        <span>AmpStack</span>
      </div>
      <div className="flex items-stretch">
        <button className={control} onClick={() => appWindow.minimize()} title="Minimize" type="button">
          <Minus className="h-4 w-4" />
        </button>
        <button className={control} onClick={() => appWindow.toggleMaximize()} title={maximized ? "Restore" : "Maximize"} type="button">
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          className="grid h-8 w-12 place-items-center text-zinc-500 transition hover:bg-rose-500/80 hover:text-white"
          onClick={() => appWindow.close()}
          title="Close"
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Invisible edge/corner grips that let a borderless window be resized again.
 *  Native resize borders disappear with `decorations: false`, so we recreate them. */
function ResizeHandles() {
  const appWindow = useMemo(() => getCurrentWindow(), []);

  // [direction, positioning + cursor classes]
  const grips: Array<[Parameters<typeof appWindow.startResizeDragging>[0], string]> = [
    ["North", "top-0 left-2 right-2 h-1 cursor-ns-resize"],
    ["South", "bottom-0 left-2 right-2 h-1 cursor-ns-resize"],
    ["West", "left-0 top-2 bottom-2 w-1 cursor-ew-resize"],
    ["East", "right-0 top-2 bottom-2 w-1 cursor-ew-resize"],
    ["NorthWest", "top-0 left-0 h-2 w-2 cursor-nwse-resize"],
    ["NorthEast", "top-0 right-0 h-2 w-2 cursor-nesw-resize"],
    ["SouthWest", "bottom-0 left-0 h-2 w-2 cursor-nesw-resize"],
    ["SouthEast", "bottom-0 right-0 h-2 w-2 cursor-nwse-resize"]
  ];

  return (
    <>
      {grips.map(([direction, className]) => (
        <div
          key={direction}
          className={`fixed z-[60] ${className}`}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            appWindow.startResizeDragging(direction).catch(() => {});
          }}
        />
      ))}
    </>
  );
}

function NavButton({
  active,
  icon,
  label,
  badge,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  badge?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`relative flex w-full items-center gap-3 rounded-lg py-2 pl-3 pr-2.5 text-left text-[0.9rem] font-medium transition ${
        active ? "bg-violet-600/10 text-violet-700" : "text-zinc-500 hover:bg-black/[0.04] hover:text-zinc-900"
      }`}
      onClick={onClick}
      type="button"
    >
      {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-violet-600" />}
      <span className={active ? "text-violet-600" : "text-zinc-400"}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge}
    </button>
  );
}

function Sidebar() {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const sourceFilter = useAppStore((state) => state.sourceFilter);
  const setSourceFilter = useAppStore((state) => state.setSourceFilter);
  const addFolders = useAppStore((state) => state.addFolders);
  const importFiles = useAppStore((state) => state.importFiles);
  const tracks = useAppStore((state) => state.tracks);
  const favoriteCount = useMemo(() => tracks.filter((track) => track.favorite).length, [tracks]);

  const addButton =
    "flex items-center gap-2.5 rounded-lg border border-black/[0.06] bg-black/[0.03] px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-violet-500/50 hover:bg-violet-600/[0.06] hover:text-violet-700";

  return (
    <aside className="glass flex w-60 shrink-0 flex-col gap-7 border-r border-black/[0.06] px-3 py-5">
      <div className="flex items-center gap-2.5 px-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-500/30">
          <Disc3 className="h-5 w-5" />
        </div>
        <span className="text-[1.05rem] font-bold tracking-tight">AmpStack</span>
      </div>

      <nav className="grid gap-0.5">
        <NavButton
          active={view === "library" && sourceFilter !== "favorites"}
          icon={<Library className="h-[18px] w-[18px]" />}
          label="Library"
          onClick={() => {
            setView("library");
            setSourceFilter("all");
          }}
        />
        <NavButton
          active={view === "library" && sourceFilter === "favorites"}
          icon={<Heart className="h-[18px] w-[18px]" />}
          label="Favorites"
          badge={favoriteCount > 0 ? <span className="text-xs tabular-nums text-zinc-400">{favoriteCount}</span> : undefined}
          onClick={() => {
            setView("library");
            setSourceFilter("favorites");
          }}
        />
        <NavButton
          active={view === "settings"}
          icon={<SettingsIcon className="h-[18px] w-[18px]" />}
          label="Settings"
          onClick={() => setView("settings")}
        />
      </nav>

      <div className="mt-auto grid gap-2">
        <p className="px-2 text-[0.7rem] font-semibold uppercase tracking-wider text-zinc-400">Add music</p>
        <button className={addButton} onClick={addFolders} type="button">
          <FolderPlus className="h-[18px] w-[18px] text-zinc-400" />
          <span>Add folder</span>
        </button>
        <button className={addButton} onClick={importFiles} type="button">
          <Import className="h-[18px] w-[18px] text-zinc-400" />
          <span>Import files</span>
        </button>
      </div>
    </aside>
  );
}

const FILTERS: { value: ReturnType<typeof useAppStore.getState>["sourceFilter"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "favorites", label: "Favorites" },
  { value: "library_file", label: "Library" },
  { value: "downloaded_file", label: "Offline" },
  { value: "remote_url", label: "Streams" },
  { value: "local_file", label: "Local" },
  { value: "missing", label: "Missing" }
];

function LibraryView({ onRename }: { onRename: (track: Track) => void }) {
  const query = useAppStore((state) => state.query);
  const setQuery = useAppStore((state) => state.setQuery);
  const sourceFilter = useAppStore((state) => state.sourceFilter);
  const setSourceFilter = useAppStore((state) => state.setSourceFilter);
  const tracks = useAppStore(selectFilteredTracks);
  const busy = useAppStore((state) => state.busy);
  const error = useAppStore((state) => state.error);
  const addRemote = useAppStore((state) => state.addRemote);
  const [url, setUrl] = useState("");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="glass flex flex-col gap-3 border-b border-black/[0.06] px-6 py-4">
        <div className="flex items-center gap-3">
          <label className="flex h-10 flex-1 items-center gap-2 rounded-xl field px-3">
            <Search className="h-[18px] w-[18px] text-zinc-400" />
            <input
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-zinc-400"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, artist, album…"
            />
          </label>
          <form
            className="flex h-10 items-center gap-2 rounded-xl field px-3"
            onSubmit={(event) => {
              event.preventDefault();
              addRemote(url);
              setUrl("");
            }}
          >
            <Link2 className="h-[18px] w-[18px] text-zinc-400" />
            <input
              className="w-56 min-w-0 bg-transparent outline-none placeholder:text-zinc-400"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Paste audio URL"
            />
            <button
              className="flex items-center gap-1 rounded-lg bg-violet-600/10 px-2.5 py-1 text-sm text-violet-700 transition hover:bg-violet-600/20"
              type="submit"
            >
              <Download className="h-4 w-4" />
              Add
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              className={`rounded-full px-3 py-1 text-[0.82rem] font-medium transition ${
                sourceFilter === filter.value
                  ? "bg-violet-600 text-white shadow-sm shadow-violet-500/30"
                  : "bg-black/[0.04] text-zinc-500 hover:bg-black/[0.06] hover:text-zinc-900"
              }`}
              onClick={() => setSourceFilter(filter.value)}
              type="button"
            >
              {filter.label}
            </button>
          ))}
          <span className="ml-auto text-[0.82rem] tabular-nums text-zinc-400">
            {busy ? "Working…" : `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`}
          </span>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <XCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {tracks.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-zinc-400">
            <div className="grid justify-items-center gap-3">
              <Disc3 className="h-10 w-10 text-zinc-300" />
              <p>{busy ? "Loading your library…" : "No tracks here yet. Add a folder, import files, or paste an audio URL."}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-0.5">
            {tracks.map((track) => (
              <TrackRow track={track} key={track.id} onRename={onRename} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsView() {
  const settings = useAppStore((state) => state.settings);
  const changeDownloadsDir = useAppStore((state) => state.changeDownloadsDir);
  const changeDataDir = useAppStore((state) => state.changeDataDir);
  const restartRequired = useAppStore((state) => state.restartRequired);
  const restartApp = useAppStore((state) => state.restartApp);
  const libraryRoots = useAppStore((state) => state.libraryRoots);
  const rescanRoot = useAppStore((state) => state.rescanRoot);
  const relinkRoot = useAppStore((state) => state.relinkRoot);
  const removeRoot = useAppStore((state) => state.removeRoot);
  const addFolders = useAppStore((state) => state.addFolders);
  const busy = useAppStore((state) => state.busy);
  const downloadExternalSource = useAppStore((state) => state.downloadExternalSource);

  const [externalUrl, setExternalUrl] = useState("");
  const [ytdlp, setYtdlp] = useState<YtDlpStatus | null>(null);

  useEffect(() => {
    checkYtDlp().then(setYtdlp).catch(() => setYtdlp(null));
  }, []);

  const card = "glass rounded-2xl p-5";

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto grid max-w-2xl gap-5">
        <h1 className="text-2xl font-bold">Settings</h1>

        {restartRequired && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <RotateCcw className="h-4 w-4 shrink-0" />
            <span className="flex-1">Data folder changed. Restart AmpStack to use the new location.</span>
            <button
              className="rounded-lg bg-amber-500/20 px-3 py-1 font-medium text-amber-800 transition hover:bg-amber-500/30"
              onClick={restartApp}
              type="button"
            >
              Restart now
            </button>
          </div>
        )}

        <section className={card}>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="font-semibold">Data folder</h2>
            <span className="rounded-md bg-violet-600/10 px-2 py-0.5 text-[0.7rem] font-medium text-violet-600">Sync</span>
          </div>
          <p className="mb-3 text-sm text-zinc-400">
            Holds your library database and downloads. Point this at a synced folder (Syncthing, Dropbox, etc.) to share your
            music across devices. Existing data is copied over; takes effect after a restart.
          </p>
          <div className="flex items-center gap-3 rounded-lg border border-black/[0.07] bg-white/60 px-3 py-2">
            <FolderOpen className="h-[18px] w-[18px] text-violet-600" />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-700" title={settings?.dataDir}>
              {settings?.dataDir ?? "…"}
            </span>
            <button
              className="rounded-lg bg-violet-600/10 px-3 py-1 text-sm text-violet-700 transition hover:bg-violet-600/20"
              onClick={changeDataDir}
              type="button"
            >
              Change
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-400">Tip: only run AmpStack on one device at a time when syncing, to avoid database conflicts.</p>
        </section>

        <section className={card}>
          <h2 className="mb-1 font-semibold">Downloads folder</h2>
          <p className="mb-3 text-sm text-zinc-400">Where downloaded songs are saved. Files are named after the song.</p>
          <div className="flex items-center gap-3 rounded-lg border border-black/[0.07] bg-white/60 px-3 py-2">
            <FolderOpen className="h-[18px] w-[18px] text-violet-600" />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-700" title={settings?.downloadsDir}>
              {settings?.downloadsDir ?? "…"}
            </span>
            <button
              className="rounded-lg bg-violet-600/10 px-3 py-1 text-sm text-violet-700 transition hover:bg-violet-600/20"
              onClick={changeDownloadsDir}
              type="button"
            >
              Change
            </button>
          </div>
        </section>

        <section className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Library folders</h2>
            <button
              className="flex items-center gap-2 rounded-lg bg-violet-600/10 px-3 py-1 text-sm text-violet-700 transition hover:bg-violet-600/20"
              onClick={addFolders}
              type="button"
            >
              <FolderPlus className="h-4 w-4" /> Add folder
            </button>
          </div>
          {libraryRoots.length === 0 ? (
            <p className="text-sm text-zinc-400">No folders yet. Add one to scan your music.</p>
          ) : (
            <div className="grid gap-2">
              {libraryRoots.map((root) => (
                <div key={root.id} className="flex items-center gap-2 rounded-lg border border-black/[0.07] bg-white/60 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-700" title={root.path}>
                    {root.path}
                  </span>
                  <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-black/[0.05] hover:text-zinc-900 disabled:opacity-40" disabled={busy} onClick={() => rescanRoot(root.id)} title="Rescan" type="button">
                    <RefreshCcw className="h-4 w-4" />
                  </button>
                  <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-black/[0.05] hover:text-zinc-900 disabled:opacity-40" disabled={busy} onClick={() => relinkRoot(root.id)} title="Locate this folder on this device (fixes missing tracks after syncing)" type="button">
                    <Link2 className="h-4 w-4" />
                  </button>
                  <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-black/[0.05] hover:text-rose-600 disabled:opacity-40" disabled={busy} onClick={() => removeRoot(root.id)} title="Remove" type="button">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={card}>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold">Download from an external source</h2>
            {ytdlp && (
              <span className={`flex items-center gap-1 text-xs ${ytdlp.available ? "text-emerald-600" : "text-rose-600"}`}>
                {ytdlp.available ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                yt-dlp {ytdlp.available ? ytdlp.version ?? "ready" : "not found"}
              </span>
            )}
          </div>
          <p className="mb-3 text-sm text-zinc-400">Uses yt-dlp + ffmpeg. The saved file is named after the song.</p>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !externalUrl.trim()) return;
              downloadExternalSource(externalUrl, true);
              setExternalUrl("");
            }}
          >
            <div className="flex items-center gap-2 rounded-lg field px-3 py-2">
              <HardDriveDownload className="h-[18px] w-[18px] text-zinc-400" />
              <input
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-zinc-400"
                value={externalUrl}
                onChange={(event) => setExternalUrl(event.target.value)}
                placeholder="External source URL"
              />
            </div>
            <button
              className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              disabled={busy || !externalUrl.trim()}
              type="submit"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Download
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function PlayerBar() {
  const playback = useAppStore((state) => state.playback);
  const activeTrack = useAppStore(selectActiveTrack);
  const togglePlay = useAppStore((state) => state.togglePlay);
  const next = useAppStore((state) => state.next);
  const previous = useAppStore((state) => state.previous);
  const seek = useAppStore((state) => state.seek);
  const setVolume = useAppStore((state) => state.setVolume);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const shuffle = useAppStore((state) => state.shuffle);
  const repeat = useAppStore((state) => state.repeat);
  const toggleShuffle = useAppStore((state) => state.toggleShuffle);
  const cycleRepeat = useAppStore((state) => state.cycleRepeat);

  const isPlaying = playback.status === "playing";
  const hasTrack = Boolean(playback.trackId);
  const duration = playback.durationSeconds ?? 0;

  const VolumeIcon = playback.volume === 0 ? VolumeX : playback.volume < 0.5 ? Volume1 : Volume2;

  return (
    <footer className="glass flex items-center gap-4 border-t border-black/[0.06] px-5 py-3">
      {/* Now playing */}
      <div className="flex w-[24%] min-w-0 items-center gap-3">
        <AlbumArt track={activeTrack} size="lg" />
        <div className="min-w-0">
          <div className="truncate text-[0.95rem] font-semibold text-zinc-900">{activeTrack?.title ?? playback.title ?? "Nothing playing"}</div>
          <div className="truncate text-[0.82rem] text-zinc-500">{activeTrack?.artist ?? (hasTrack ? "Unknown artist" : "Pick a track to start")}</div>
        </div>
        {activeTrack && (
          <button
            className={`rounded-lg p-1.5 transition hover:bg-black/[0.05] ${activeTrack.favorite ? "text-violet-600" : "text-zinc-400 hover:text-zinc-800"}`}
            onClick={() => toggleFavorite(activeTrack.id)}
            title={activeTrack.favorite ? "Remove from favorites" : "Add to favorites"}
            type="button"
          >
            <Heart className={activeTrack.favorite ? "fill-current" : ""} />
          </button>
        )}
      </div>

      {/* Transport + progress */}
      <div className="flex flex-1 flex-col items-center gap-2">
        <div className="flex items-center gap-4">
          <button
            className={`rounded-lg p-1.5 transition hover:bg-black/[0.05] ${shuffle ? "text-violet-600" : "text-zinc-500 hover:text-zinc-900"}`}
            onClick={toggleShuffle}
            title="Shuffle"
            type="button"
          >
            <Shuffle className="h-[18px] w-[18px]" />
          </button>
          <button className="rounded-lg p-1.5 text-zinc-700 transition hover:bg-black/[0.05] hover:text-zinc-900 disabled:opacity-40" onClick={previous} disabled={!hasTrack} title="Previous" type="button">
            <SkipBack className="h-5 w-5" />
          </button>
          <button
            className="grid h-11 w-11 place-items-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-500/30 transition duration-150 hover:scale-105 hover:shadow-violet-500/50 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            onClick={togglePlay}
            disabled={!hasTrack}
            title={isPlaying ? "Pause" : "Play"}
            type="button"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-[1px]" />}
          </button>
          <button className="rounded-lg p-1.5 text-zinc-700 transition hover:bg-black/[0.05] hover:text-zinc-900 disabled:opacity-40" onClick={next} disabled={!hasTrack} title="Next" type="button">
            <SkipForward className="h-5 w-5" />
          </button>
          <button
            className={`rounded-lg p-1.5 transition hover:bg-black/[0.05] ${repeat !== "off" ? "text-violet-600" : "text-zinc-500 hover:text-zinc-900"}`}
            onClick={cycleRepeat}
            title={`Repeat: ${repeat}`}
            type="button"
          >
            {repeat === "one" ? <Repeat1 className="h-[18px] w-[18px]" /> : <Repeat className="h-[18px] w-[18px]" />}
          </button>
        </div>
        <div className="flex w-full max-w-xl items-center gap-3">
          <span className="w-10 text-right text-xs tabular-nums text-zinc-400">{formatSeconds(playback.positionSeconds)}</span>
          <Slider
            value={playback.positionSeconds}
            max={duration}
            disabled={!hasTrack || duration === 0}
            onChange={(value) => seek(value)}
          />
          <span className="w-10 text-xs tabular-nums text-zinc-400">{playback.durationSeconds ? formatSeconds(duration) : "--:--"}</span>
        </div>
      </div>

      {/* Volume */}
      <div className="flex w-[24%] items-center justify-end gap-2">
        <VolumeIcon className="h-[18px] w-[18px] text-zinc-400" />
        <div className="w-28">
          <Slider value={playback.volume} max={1} step={0.01} onChange={(value) => setVolume(value)} />
        </div>
      </div>
    </footer>
  );
}

function DownloadsToast() {
  const downloads = useAppStore(selectActiveDownloads);
  if (downloads.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-24 right-5 z-40 flex w-80 flex-col gap-2">
      {downloads.map((job) => {
        const pct = job.totalBytes ? Math.min(100, Math.round((job.progressBytes / job.totalBytes) * 100)) : null;
        const indeterminate = job.status === "processing" || (job.status === "downloading" && pct === null);
        const barWidth = job.status === "complete" ? 100 : pct ?? 0;
        return (
          <div key={job.id} className="glass-strong amp-rise pointer-events-auto rounded-xl border border-black/[0.07] p-3">
            <div className="mb-1 flex items-center gap-2">
              {job.status === "complete" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : job.status === "failed" ? (
                <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                {job.title ?? (job.kind === "external" ? "External download" : "Download")}
              </span>
              {job.status === "downloading" && pct !== null && (
                <span className="text-xs tabular-nums text-zinc-500">{pct}%</span>
              )}
            </div>
            <div className="mb-2 truncate text-xs text-zinc-400">{job.error ?? job.stage ?? "Working…"}</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
              <div
                className={`h-full rounded-full transition-[width] ${
                  job.status === "failed" ? "bg-rose-500" : "bg-violet-600"
                } ${indeterminate ? "w-full animate-pulse" : ""}`}
                style={indeterminate ? undefined : { width: `${barWidth}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function App() {
  const loadInitialData = useAppStore((state) => state.loadInitialData);
  const setPlayback = useAppStore((state) => state.setPlayback);
  const setDownloadProgress = useAppStore((state) => state.setDownloadProgress);
  const view = useAppStore((state) => state.view);
  const [renameTarget, setRenameTarget] = useState<Track | null>(null);
  const endedGuard = useRef(false);

  useEffect(() => {
    loadInitialData();

    const unlisteners: Array<() => void> = [];
    listenPlayback(setPlayback).then((unlisten) => unlisteners.push(unlisten));
    listenDownloadProgress(setDownloadProgress).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [loadInitialData, setDownloadProgress, setPlayback]);

  // Poll position while playing, and auto-advance the queue when a track ends.
  useEffect(() => {
    const interval = window.setInterval(async () => {
      const state = useAppStore.getState();
      if (state.playback.status !== "playing") return;
      await state.refreshPlayback();
      const after = useAppStore.getState().playback.status;
      if (after === "stopped" && !endedGuard.current) {
        endedGuard.current = true;
        await useAppStore.getState().handleTrackEnded();
        endedGuard.current = false;
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="amp-bg flex h-screen w-screen flex-col overflow-hidden text-zinc-900">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div key={view} className="amp-rise flex min-h-0 flex-1 flex-col">
          {view === "settings" ? <SettingsView /> : <LibraryView onRename={setRenameTarget} />}
        </div>
      </div>
      <PlayerBar />
      <DownloadsToast />
      <ResizeHandles />
      {renameTarget && <RenameDialog track={renameTarget} onClose={() => setRenameTarget(null)} />}
    </div>
  );
}
