import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Disc3,
  Download,
  FolderOpen,
  FolderPlus,
  HardDriveDownload,
  Heart,
  Import,
  Library,
  Link2,
  ListMusic,
  Loader2,
  Mic2,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Repeat,
  Repeat1,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
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

const ACCENT = "#c8954c";
const ACCENT_SOFT = "#9a7a45";

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

/** A track that lives on disk (vs. a remote stream) shows a filled "sync" dot. */
function isOffline(track: Track): boolean {
  return track.sourceType !== "remote_url";
}

/* ════════════════════════════════════════════════════════════════════════
   Equalizer tiles stand in for album art throughout the redesign: a frosted
   rounded square holding vertical bars. The actively-playing tile glows gold
   and gently breathes; everything else is muted and still.
   ════════════════════════════════════════════════════════════════════════ */
function Equalizer({
  tile,
  radius,
  gap,
  padBottom,
  barWidth,
  bars,
  color,
  animate,
  surface
}: {
  tile: number;
  radius: number;
  gap: number;
  padBottom: number;
  barWidth: number;
  bars: number[];
  color: string | string[];
  animate?: boolean;
  surface?: CSSProperties;
}) {
  return (
    <div
      className={`flex shrink-0 items-end justify-center ${animate ? "eq-anim" : ""}`}
      style={{
        width: tile,
        height: tile,
        gap,
        paddingBottom: padBottom,
        borderRadius: radius,
        background: "rgba(255,255,255,.06)",
        border: "1px solid rgba(255,255,255,.09)",
        ...surface
      }}
    >
      {bars.map((height, index) => (
        <span
          key={index}
          className="eq-bar"
          style={{
            width: barWidth,
            height,
            borderRadius: 2,
            background: Array.isArray(color) ? color[index % color.length] : color
          }}
        />
      ))}
    </div>
  );
}

/** The small tile shown in track rows and the player bar. */
function TrackTile({ playing, size }: { playing: boolean; size: "row" | "bar" }) {
  if (size === "bar") {
    return (
      <Equalizer
        tile={52}
        radius={12}
        gap={3}
        padBottom={15}
        barWidth={3.5}
        bars={[16, 9, 22, 13]}
        color={ACCENT}
        animate={playing}
      />
    );
  }
  return playing ? (
    <Equalizer tile={42} radius={11} gap={2.5} padBottom={12} barWidth={3} bars={[14, 8, 18, 11]} color={ACCENT} animate />
  ) : (
    <Equalizer
      tile={42}
      radius={11}
      gap={2.5}
      padBottom={12}
      barWidth={3}
      bars={[9, 15, 11, 17]}
      color="rgba(255,255,255,.38)"
    />
  );
}

/** Gold-filled range slider whose fill follows the current value. */
function Slider({
  value,
  max,
  step,
  disabled,
  plain,
  onChange,
  className
}: {
  value: number;
  max: number;
  step?: number;
  disabled?: boolean;
  plain?: boolean;
  onChange: (value: number) => void;
  className?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  return (
    <input
      type="range"
      className={`amp-range ${plain ? "amp-range-plain" : ""} w-full ${className ?? ""}`}
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
  const inputClass =
    "mb-3 w-full rounded-xl field-sunken px-3 py-2 text-white outline-none placeholder:text-white/35";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-strong amp-pop w-full max-w-md rounded-3xl p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="ff-display text-lg font-bold text-white">Edit track</h2>
          <button
            className="rounded-lg p-1 text-white/45 transition hover:bg-white/[0.08] hover:text-white"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </button>
        </div>
        <label className="mb-1.5 block text-sm text-white/55">Title</label>
        <input
          autoFocus
          className={inputClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
        />
        <label className="mb-1.5 block text-sm text-white/55">Artist</label>
        <input
          className={inputClass}
          value={artist}
          onChange={(event) => setArtist(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
        />
        {renamesFile && (
          <p className="mb-4 text-xs text-white/40">The downloaded file on disk will be renamed to match.</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded-xl px-4 py-2 text-white/75 transition hover:bg-white/[0.08]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="accent-glow rounded-xl px-5 py-2 font-bold text-white transition hover:brightness-110 disabled:opacity-50"
            style={{ background: ACCENT }}
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

const ROW_COLUMNS = "46px 1fr 150px 44px 56px auto";

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

  const action =
    "grid h-7 w-7 place-items-center rounded-lg text-white/45 opacity-0 transition hover:bg-white/[0.1] hover:text-white group-hover:opacity-100 disabled:opacity-30 [&_svg]:h-[15px] [&_svg]:w-[15px]";

  return (
    <div
      className={`group grid items-center gap-4 px-7 py-[9px] transition ${track.missing ? "opacity-50" : ""}`}
      style={{ gridTemplateColumns: ROW_COLUMNS, borderBottom: "1px solid rgba(255,255,255,.05)" }}
      onMouseEnter={(event) => (event.currentTarget.style.background = "rgba(255,255,255,.06)")}
      onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
    >
      <button
        className="relative grid place-items-center justify-self-center rounded-[11px]"
        onClick={() => (isActive ? togglePlay() : playTrack(track.id))}
        title={isPlaying ? "Pause" : "Play"}
        type="button"
      >
        <TrackTile playing={isPlaying} size="row" />
        <span
          className={`absolute inset-0 grid place-items-center rounded-[11px] bg-black/45 text-white transition ${
            isActive ? "opacity-0" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </span>
      </button>

      <button className="grid min-w-0 gap-0.5 text-left" onClick={() => playTrack(track.id)} type="button">
        <span
          className="truncate text-[15px] font-semibold"
          style={{ color: isActive ? ACCENT : "#fff" }}
        >
          {track.title}
        </span>
        <span className="truncate text-[12.5px] text-white/50">
          {track.artist ?? "Unknown artist"}
          {track.missing ? " · Missing" : ""}
        </span>
      </button>

      <span className="truncate text-[12px] text-white/40">{track.album ?? sourceLabel(track)}</span>

      <div className="flex justify-center" title={sourceLabel(track)}>
        {isDownloading ? (
          <span className="ff-mono text-[11px]" style={{ color: ACCENT }}>
            {downloadPct !== null ? `${downloadPct}%` : "…"}
          </span>
        ) : isOffline(track) ? (
          <span className="h-[7px] w-[7px] rounded-full bg-white/45" />
        ) : (
          <span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-white/30" />
        )}
      </div>

      <span className="ff-mono text-right text-[12px] text-white/50">{formatSeconds(track.durationSeconds)}</span>

      <div className="flex items-center justify-end gap-0.5">
        {track.sourceType === "remote_url" && (
          <button
            className={action}
            disabled={busy || isDownloading}
            onClick={() => downloadTrack(track.id)}
            title="Download for offline"
            type="button"
          >
            {isDownloading ? <Loader2 className="animate-spin" /> : <HardDriveDownload />}
          </button>
        )}
        <button className={action} onClick={() => onRename(track)} title="Edit title / artist" type="button">
          <Pencil />
        </button>
        <button
          className={`${action} hover:!text-rose-400`}
          onClick={() => {
            if (
              window.confirm(
                `Remove "${track.title}" from AmpStack? Local files stay on disk; app-downloaded copies are deleted.`
              )
            ) {
              deleteTrack(track.id);
            }
          }}
          title="Remove from library"
          type="button"
        >
          <Trash2 />
        </button>
        <button
          className={`grid h-7 w-7 place-items-center rounded-lg transition hover:bg-white/[0.1] [&_svg]:h-[15px] [&_svg]:w-[15px] ${
            track.favorite ? "" : "text-white/35 opacity-0 hover:text-white group-hover:opacity-100"
          }`}
          style={track.favorite ? { color: ACCENT } : undefined}
          onClick={() => toggleFavorite(track.id)}
          title={track.favorite ? "Remove from favorites" : "Add to favorites"}
          type="button"
        >
          <Heart className={track.favorite ? "fill-current" : ""} />
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

/** The little gold logo mark used in the title bar and sidebar. */
function LogoMark({ size }: { size: number }) {
  return (
    <div
      className="grid place-items-center"
      style={{ width: size, height: size, borderRadius: size * 0.29, background: ACCENT }}
    >
      <span
        className="rounded-full border-white"
        style={{ width: size * 0.34, height: size * 0.34, borderWidth: Math.max(1.5, size * 0.05) }}
      />
    </div>
  );
}

/** Custom window frame: a draggable bar with min / maximize / close controls,
 *  so we get a consistent look instead of the dated GTK title bar on Linux. */
function TitleBar() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const maximized = useIsMaximized();

  const control = "grid h-8 w-12 place-items-center text-white/45 transition hover:bg-white/[0.08] hover:text-white";

  return (
    <div
      data-tauri-drag-region
      className="flex h-[46px] shrink-0 select-none items-center justify-between px-2"
      style={{ borderBottom: "1px solid rgba(255,255,255,.05)" }}
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5 pl-2">
        <LogoMark size={18} />
        <span className="ff-display text-[13px] font-bold text-white">AmpStack</span>
      </div>
      <div className="flex items-stretch">
        <button className={control} onClick={() => appWindow.minimize()} title="Minimize" type="button">
          <Minus className="h-4 w-4" />
        </button>
        <button
          className={control}
          onClick={() => appWindow.toggleMaximize()}
          title={maximized ? "Restore" : "Maximize"}
          type="button"
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          className="grid h-8 w-12 place-items-center text-white/45 transition hover:bg-rose-500/80 hover:text-white"
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
      className={`flex h-11 w-full items-center gap-3 rounded-[13px] px-3.5 text-left text-[14.5px] transition ${
        active ? "font-bold text-white" : "font-medium text-white/60 hover:bg-white/[0.06] hover:text-white"
      }`}
      style={active ? { background: "rgba(200,149,76,.15)", border: "1px solid rgba(255,255,255,.18)" } : undefined}
      onClick={onClick}
      type="button"
    >
      {icon}
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
    "flex h-[42px] items-center gap-3 rounded-xl px-3.5 text-[13.5px] font-medium text-white/70 transition hover:bg-white/[0.06] hover:text-white";

  return (
    <aside
      className="flex w-[236px] shrink-0 flex-col px-4 py-6"
      style={{ background: "rgba(255,255,255,.035)", borderRight: "1px solid rgba(255,255,255,.08)" }}
    >
      <div className="flex items-center gap-3 px-1.5 pb-6">
        <LogoMark size={38} />
        <span className="ff-display text-[20px] font-extrabold tracking-tight text-white">AmpStack</span>
      </div>

      <nav className="flex flex-col gap-1">
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
          badge={<span className="ff-mono text-[11px] text-white/40">{favoriteCount}</span>}
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

      <div className="mt-auto flex flex-col gap-2">
        <p className="ff-mono px-1.5 pb-1 text-[10.5px] uppercase tracking-[0.08em] text-white/35">Add music</p>
        <button
          className={addButton}
          style={{ border: "1px solid rgba(255,255,255,.12)" }}
          onClick={addFolders}
          type="button"
        >
          <FolderPlus className="h-4 w-4" />
          <span>Add folder</span>
        </button>
        <button
          className={addButton}
          style={{ border: "1px solid rgba(255,255,255,.12)" }}
          onClick={importFiles}
          type="button"
        >
          <Import className="h-4 w-4" />
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
  const downloadExternalSource = useAppStore((state) => state.downloadExternalSource);
  const [url, setUrl] = useState("");
  const [ytdlp, setYtdlp] = useState<YtDlpStatus | null>(null);

  useEffect(() => {
    checkYtDlp().then(setYtdlp).catch(() => setYtdlp(null));
  }, []);

  const title = sourceFilter === "favorites" ? "Favorites" : "All Tracks";
  const canDownload = Boolean(url.trim()) && ytdlp?.available !== false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-end justify-between px-7 pb-[18px] pt-6">
        <div>
          <div className="ff-mono mb-1.5 text-[11px] uppercase tracking-[0.14em]" style={{ color: "#d8b27a" }}>
            Your Music
          </div>
          <h1 className="ff-display text-[34px] font-extrabold leading-none tracking-[-0.025em] text-white">{title}</h1>
        </div>
        <form
          className="field flex h-11 w-[360px] items-center gap-2 rounded-[13px] py-0 pl-4 pr-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            addRemote(url);
            setUrl("");
          }}
        >
          <Link2 className="h-[15px] w-[15px] text-white/45" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/45"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste audio URL"
          />
          <button
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-white/70 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-35"
            type="button"
            disabled={!canDownload}
            onClick={() => {
              downloadExternalSource(url, true);
              setUrl("");
            }}
            title={
              ytdlp?.available === false
                ? "yt-dlp not found — install it to download for offline"
                : "Download for offline (yt-dlp)"
            }
          >
            <HardDriveDownload className="h-[16px] w-[16px]" />
          </button>
          <button
            className="accent-glow flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-4 text-[12.5px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
            style={{ background: ACCENT }}
            type="submit"
            disabled={!url.trim()}
          >
            <Plus className="h-3 w-3" strokeWidth={2.6} />
            Add
          </button>
        </form>
      </div>

      <div className="px-7 pb-4">
        <label className="field flex h-[46px] items-center gap-3 rounded-2xl px-4">
          <Search className="h-[17px] w-[17px] text-white/50" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/45"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title, artist, album…"
          />
        </label>
      </div>

      <div className="flex items-center justify-between px-7 pb-3.5">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const active = sourceFilter === filter.value;
            return (
              <button
                key={filter.value}
                className={`rounded-[10px] px-[15px] py-[7px] text-[12.5px] transition ${
                  active ? "font-bold text-white" : "font-medium text-white/60 hover:text-white"
                }`}
                style={active ? { background: ACCENT } : { border: "1px solid rgba(255,255,255,.12)" }}
                onClick={() => setSourceFilter(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            );
          })}
        </div>
        <span className="ff-mono shrink-0 pl-3 text-[12px] text-white/45">
          {busy ? "Working…" : `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`}
        </span>
      </div>

      {error && (
        <div className="mx-7 mb-3 flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-sm text-rose-200">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div
        className="grid items-center gap-4 px-7 pb-2.5"
        style={{ gridTemplateColumns: ROW_COLUMNS, borderBottom: "1px solid rgba(255,255,255,.09)" }}
      >
        {(["#", "Title", "Source", "Sync", "Time"] as const).map((label, index) => (
          <span
            key={label}
            className={`ff-mono text-[10.5px] uppercase tracking-[0.06em] text-white/30 ${
              index === 0 ? "text-center" : index === 3 ? "text-center" : index === 4 ? "text-right" : ""
            }`}
          >
            {label}
          </span>
        ))}
        <span />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tracks.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-white/40">
            <div className="grid justify-items-center gap-3">
              <Disc3 className="h-10 w-10 text-white/20" />
              <p>{busy ? "Loading your library…" : "No tracks here yet. Add a folder, import files, or paste an audio URL."}</p>
            </div>
          </div>
        ) : (
          tracks.map((track) => <TrackRow track={track} key={track.id} onRename={onRename} />)
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

  const cardClass = "card rounded-[18px] p-6";
  const heading = "ff-display text-[18px] font-bold text-white";
  const body = "text-[13.5px] leading-relaxed text-white/55";
  const pathRow = "field-sunken flex h-12 items-center gap-3 rounded-xl py-0 pl-3.5 pr-2";
  const pathText = "ff-mono min-w-0 flex-1 truncate text-[13px] text-white/85";
  const changeButton =
    "h-[34px] shrink-0 rounded-[9px] px-4 text-[12.5px] font-semibold transition hover:bg-white/[0.16]";
  const accentButton =
    "accent-glow flex h-9 items-center gap-2 rounded-[10px] px-4 text-[12.5px] font-bold text-white transition hover:brightness-110";

  return (
    <div className="min-h-0 flex-1 overflow-auto px-8 pb-3 pt-9">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-[22px]">
        <div>
          <div className="ff-mono mb-1.5 text-[11px] uppercase tracking-[0.14em]" style={{ color: "#d8b27a" }}>
            Preferences
          </div>
          <h1 className="ff-display text-[36px] font-extrabold leading-none tracking-[-0.025em] text-white">Settings</h1>
        </div>

        {restartRequired && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            <RotateCcw className="h-4 w-4 shrink-0" />
            <span className="flex-1">Data folder changed. Restart AmpStack to use the new location.</span>
            <button
              className="rounded-lg bg-amber-400/20 px-3 py-1 font-medium text-amber-100 transition hover:bg-amber-400/30"
              onClick={restartApp}
              type="button"
            >
              Restart now
            </button>
          </div>
        )}

        <section className={cardClass}>
          <div className="mb-2 flex items-center gap-2.5">
            <h2 className={heading}>Data folder</h2>
            <span
              className="ff-mono rounded-md px-2.5 py-[3px] text-[10px] uppercase tracking-[0.06em] text-white"
              style={{ background: ACCENT }}
            >
              Sync
            </span>
          </div>
          <p className={`${body} mb-4`}>
            Holds your library database and downloads. Point this at a synced folder (Syncthing, Dropbox, etc.) to share
            your music across devices. Existing data is copied over; takes effect after a restart.
          </p>
          <div className={pathRow}>
            <FolderOpen className="h-[17px] w-[17px]" style={{ color: ACCENT }} />
            <span className={pathText} title={settings?.dataDir}>
              {settings?.dataDir ?? "…"}
            </span>
            <button
              className={changeButton}
              style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.16)", color: "#e3cda6" }}
              onClick={changeDataDir}
              type="button"
            >
              Change
            </button>
          </div>
          <p className="mt-3 text-[12px] text-white/40">
            Tip: only run AmpStack on one device at a time when syncing, to avoid database conflicts.
          </p>
        </section>

        <section className={cardClass}>
          <h2 className={`${heading} mb-1.5`}>Downloads folder</h2>
          <p className={`${body} mb-4`}>Where downloaded songs are saved. Files are named after the song.</p>
          <div className={pathRow}>
            <FolderOpen className="h-[17px] w-[17px]" style={{ color: ACCENT }} />
            <span className={pathText} title={settings?.downloadsDir}>
              {settings?.downloadsDir ?? "…"}
            </span>
            <button
              className={changeButton}
              style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.16)", color: "#e3cda6" }}
              onClick={changeDownloadsDir}
              type="button"
            >
              Change
            </button>
          </div>
        </section>

        <section className={cardClass}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <h2 className={heading}>Library folders</h2>
            <button className={accentButton} style={{ background: ACCENT }} onClick={addFolders} type="button">
              <FolderPlus className="h-3.5 w-3.5" /> Add folder
            </button>
          </div>
          {libraryRoots.length === 0 ? (
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-[18px] text-[13.5px] text-white/50"
              style={{ border: "1px dashed rgba(255,255,255,.16)", background: "rgba(255,255,255,.02)" }}
            >
              <Plus className="h-[17px] w-[17px] text-white/40" />
              No folders yet. Add one to scan your music.
            </div>
          ) : (
            <div className="grid gap-2">
              {libraryRoots.map((root) => (
                <div key={root.id} className="field-sunken flex items-center gap-2 rounded-xl px-3.5 py-2.5">
                  <span className="ff-mono min-w-0 flex-1 truncate text-[13px] text-white/80" title={root.path}>
                    {root.path}
                  </span>
                  <button
                    className="grid h-8 w-8 place-items-center rounded-lg text-white/55 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-40"
                    disabled={busy}
                    onClick={() => rescanRoot(root.id)}
                    title="Rescan"
                    type="button"
                  >
                    <RefreshCcw className="h-4 w-4" />
                  </button>
                  <button
                    className="grid h-8 w-8 place-items-center rounded-lg text-white/55 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-40"
                    disabled={busy}
                    onClick={() => relinkRoot(root.id)}
                    title="Locate this folder on this device (fixes missing tracks after syncing)"
                    type="button"
                  >
                    <Link2 className="h-4 w-4" />
                  </button>
                  <button
                    className="grid h-8 w-8 place-items-center rounded-lg text-white/55 transition hover:bg-white/[0.1] hover:text-rose-400 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => removeRoot(root.id)}
                    title="Remove"
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** The 90px transport strip that lives at the foot of the library / settings
 *  content. Clicking the now-playing card opens the full Now Playing view. */
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
  const setView = useAppStore((state) => state.setView);

  const isPlaying = playback.status === "playing";
  const hasTrack = Boolean(playback.trackId);
  const duration = playback.durationSeconds ?? 0;
  const VolumeIcon = playback.volume === 0 ? VolumeX : playback.volume < 0.5 ? Volume1 : Volume2;

  const ghost = "grid h-9 w-9 place-items-center rounded-lg text-white/75 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40";

  return (
    <div
      className="grid h-[90px] shrink-0 items-center gap-5 px-6"
      style={{
        gridTemplateColumns: "1fr 1.3fr 1fr",
        borderTop: "1px solid rgba(255,255,255,.09)",
        background: "rgba(255,255,255,.05)"
      }}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <button
          className="flex min-w-0 items-center gap-3.5 rounded-xl text-left transition hover:opacity-80 disabled:cursor-default"
          onClick={() => hasTrack && setView("nowplaying")}
          disabled={!hasTrack}
          title={hasTrack ? "Open now playing" : undefined}
          type="button"
        >
          <TrackTile playing={isPlaying} size="bar" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-white">
              {activeTrack?.title ?? playback.title ?? "Nothing playing"}
            </div>
            <div className="truncate text-[12px] text-white/50">
              {activeTrack?.artist ?? (hasTrack ? "Unknown artist" : "Pick a track to start")}
            </div>
          </div>
        </button>
        {activeTrack && (
          <button
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition hover:bg-white/[0.08]"
            style={activeTrack.favorite ? { color: ACCENT } : { color: "rgba(255,255,255,.4)" }}
            onClick={() => toggleFavorite(activeTrack.id)}
            title={activeTrack.favorite ? "Remove from favorites" : "Add to favorites"}
            type="button"
          >
            <Heart className={`h-4 w-4 ${activeTrack.favorite ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      <div className="flex flex-col items-center gap-2.5">
        <div className="flex items-center gap-[22px]">
          <button
            className={ghost}
            style={shuffle ? { color: ACCENT } : undefined}
            onClick={toggleShuffle}
            title="Shuffle"
            type="button"
          >
            <Shuffle className="h-[17px] w-[17px]" />
          </button>
          <button className={ghost} onClick={previous} disabled={!hasTrack} title="Previous" type="button">
            <SkipBack className="h-5 w-5 fill-current" />
          </button>
          <button
            className="accent-glow grid h-[46px] w-[46px] place-items-center rounded-full text-white transition hover:brightness-110 active:scale-95 disabled:opacity-50"
            style={{ background: ACCENT }}
            onClick={togglePlay}
            disabled={!hasTrack}
            title={isPlaying ? "Pause" : "Play"}
            type="button"
          >
            {isPlaying ? <Pause className="h-[18px] w-[18px] fill-current" /> : <Play className="h-[18px] w-[18px] translate-x-[1px] fill-current" />}
          </button>
          <button className={ghost} onClick={next} disabled={!hasTrack} title="Next" type="button">
            <SkipForward className="h-5 w-5 fill-current" />
          </button>
          <button
            className={ghost}
            style={repeat !== "off" ? { color: ACCENT } : undefined}
            onClick={cycleRepeat}
            title={`Repeat: ${repeat}`}
            type="button"
          >
            {repeat === "one" ? <Repeat1 className="h-[17px] w-[17px]" /> : <Repeat className="h-[17px] w-[17px]" />}
          </button>
        </div>
        <div className="flex w-full max-w-[540px] items-center gap-2.5">
          <span className="ff-mono w-9 text-right text-[11px] text-white/45">{formatSeconds(playback.positionSeconds)}</span>
          <Slider value={playback.positionSeconds} max={duration} disabled={!hasTrack || duration === 0} onChange={(value) => seek(value)} />
          <span className="ff-mono w-9 text-[11px] text-white/45">{playback.durationSeconds ? formatSeconds(duration) : "--:--"}</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-4 text-white/60">
        <button
          className={ghost}
          onClick={() => hasTrack && setView("nowplaying")}
          disabled={!hasTrack}
          title="Queue"
          type="button"
        >
          <ListMusic className="h-[17px] w-[17px]" />
        </button>
        <VolumeIcon className="h-4 w-4 text-white/60" />
        <div className="w-[88px]">
          <Slider value={playback.volume} max={1} step={0.01} plain onChange={(value) => setVolume(value)} />
        </div>
      </div>
    </div>
  );
}

/** A pill-style tab button for the Now Playing side panel. */
function PanelTab({
  icon: Icon,
  label,
  count,
  active,
  onClick
}: {
  icon: typeof Mic2;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition ${
        active ? "bg-white/[0.1] text-white" : "text-white/45 hover:text-white/75"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
      {label}
      {count ? <span className="ff-mono text-[11px] text-white/40">{count}</span> : null}
    </button>
  );
}

/** Lyrics for the active track: one-button search against LRCLIB, with synced
 *  line highlighting that follows playback when timestamped lyrics are found.
 *  Fills its container so it can occupy the full side-panel height. */
function LyricsPanel() {
  const playback = useAppStore((state) => state.playback);
  const lyrics = useAppStore((state) => state.lyrics);
  const fetchLyrics = useAppStore((state) => state.fetchLyrics);

  const trackId = playback.trackId;
  const entry = trackId ? lyrics[trackId] : undefined;

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLParagraphElement>(null);

  const activeIndex = useMemo(() => {
    if (!entry?.synced) return -1;
    const at = playback.positionSeconds + 0.25;
    let index = -1;
    for (let i = 0; i < entry.synced.length; i++) {
      if (entry.synced[i].time <= at) index = i;
      else break;
    }
    return index;
  }, [entry?.synced, playback.positionSeconds]);

  useEffect(() => {
    const box = scrollRef.current;
    const line = activeRef.current;
    if (box && line) {
      box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
    }
  }, [activeIndex]);

  const centered = "grid min-h-0 flex-1 place-items-center px-6 text-center";

  let body: ReactNode;
  if (!trackId) {
    body = (
      <div className={centered}>
        <p className="text-[13px] text-white/40">Play a track to find its lyrics.</p>
      </div>
    );
  } else if (!entry) {
    body = (
      <div className={centered}>
        <div className="flex flex-col items-center gap-4">
          <Mic2 className="h-9 w-9 text-white/15" />
          <p className="max-w-[260px] text-[13px] text-white/45">Search LRCLIB for synced lyrics to this track.</p>
          <button
            className="accent-glow flex h-10 items-center justify-center gap-2 rounded-xl px-6 text-[13px] font-bold text-white transition hover:brightness-110"
            style={{ background: ACCENT }}
            onClick={() => fetchLyrics(trackId)}
            type="button"
          >
            <Search className="h-4 w-4" /> Find lyrics
          </button>
        </div>
      </div>
    );
  } else if (entry.status === "loading") {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-1 py-1">
        <div className="flex items-center gap-2 text-[12.5px] text-white/55">
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: ACCENT }} /> Searching LRCLIB…
        </div>
        <div className="flex flex-col gap-3">
          {[82, 96, 64, 90, 73, 88, 60, 84, 70, 92].map((width, index) => (
            <div
              key={index}
              className="h-3.5 animate-pulse rounded-full bg-white/[0.08]"
              style={{ width: `${width}%`, animationDelay: `${index * 90}ms` }}
            />
          ))}
        </div>
      </div>
    );
  } else if (entry.status === "error") {
    body = (
      <div className={centered}>
        <p className="text-[13px] text-white/50">{entry.error ?? "No lyrics found."}</p>
      </div>
    );
  } else if (entry.synced) {
    body = (
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto px-1">
        <div className="mx-auto flex max-w-[680px] flex-col gap-3 py-2">
          {entry.synced.map((line, index) => (
            <p
              key={index}
              ref={index === activeIndex ? activeRef : undefined}
              className="text-[17px] leading-snug transition-all duration-300"
              style={{
                color: index === activeIndex ? "#fff" : "rgba(255,255,255,.38)",
                fontWeight: index === activeIndex ? 700 : 500
              }}
            >
              {line.text || "♪"}
            </p>
          ))}
        </div>
      </div>
    );
  } else if (entry.plain) {
    body = (
      <div className="min-h-0 flex-1 overflow-auto px-1">
        <p className="mx-auto max-w-[680px] whitespace-pre-wrap py-2 text-[15px] leading-relaxed text-white/75">
          {entry.plain}
        </p>
      </div>
    );
  } else {
    body = (
      <div className={centered}>
        <p className="text-[13px] text-white/50">No lyrics text available.</p>
      </div>
    );
  }

  const showSource = entry?.status === "ready" && (entry.synced || entry.plain) && entry.source;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {body}
      {showSource && (
        <div className="ff-mono mt-3 shrink-0 text-[10px] uppercase tracking-[0.06em] text-white/30">
          Source · {entry?.source}
        </div>
      )}
    </div>
  );
}

/** Right side of Now Playing: a full-height panel that tabs between Lyrics and
 *  the Up Next queue, so lyrics get real room instead of a cramped corner card. */
function NowPlayingPanel() {
  const queue = useAppStore((state) => state.queue);
  const queueIndex = useAppStore((state) => state.queueIndex);
  const tracks = useAppStore((state) => state.tracks);
  const clearQueue = useAppStore((state) => state.clearQueue);
  const playTrack = useAppStore((state) => state.playTrack);
  const lyrics = useAppStore((state) => state.lyrics);
  const fetchLyrics = useAppStore((state) => state.fetchLyrics);
  const trackId = useAppStore((state) => state.playback.trackId);

  // Default to the queue; lyrics stay hidden until the user opens the tab and
  // explicitly searches (results are then cached, so it won't re-download).
  const [tab, setTab] = useState<"lyrics" | "queue">("queue");

  const upNext = useMemo(
    () =>
      queue
        .slice(queueIndex + 1)
        .map((id) => tracks.find((track) => track.id === id))
        .filter((track): track is Track => Boolean(track)),
    [queue, queueIndex, tracks]
  );

  const lyricsEntry = trackId ? lyrics[trackId] : undefined;

  return (
    <div
      className="flex min-w-0 flex-1 flex-col px-7 py-7"
      style={{ borderLeft: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.04)" }}
    >
      <div className="mb-5 flex items-center gap-3">
        <div className="flex flex-1 gap-1 rounded-xl bg-white/[0.04] p-1">
          <PanelTab icon={Mic2} label="Lyrics" active={tab === "lyrics"} onClick={() => setTab("lyrics")} />
          <PanelTab
            icon={ListMusic}
            label="Up Next"
            count={upNext.length}
            active={tab === "queue"}
            onClick={() => setTab("queue")}
          />
        </div>
        {tab === "lyrics" ? (
          <button
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/45 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-40"
            onClick={() => trackId && fetchLyrics(trackId, true)}
            disabled={!trackId || lyricsEntry?.status === "loading"}
            title="Search again"
            type="button"
          >
            <RefreshCcw className={`h-4 w-4 ${lyricsEntry?.status === "loading" ? "animate-spin" : ""}`} />
          </button>
        ) : (
          upNext.length > 0 && (
            <button
              className="ff-mono shrink-0 text-[11px] text-white/40 transition hover:text-white"
              onClick={clearQueue}
              type="button"
            >
              CLEAR
            </button>
          )
        )}
      </div>

      {tab === "lyrics" ? (
        <LyricsPanel />
      ) : (
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-auto px-1">
          {upNext.length === 0 ? (
            <p className="px-1 text-[13px] text-white/40">Nothing queued. Play a track to build a queue.</p>
          ) : (
            upNext.map((track, index) => (
              <button
                key={`${track.id}-${index}`}
                className="flex items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/[0.06]"
                onClick={() => playTrack(track.id)}
                type="button"
              >
                <Equalizer
                  tile={40}
                  radius={10}
                  gap={2.5}
                  padBottom={11}
                  barWidth={3}
                  bars={[9, 15, 11]}
                  color="rgba(255,255,255,.38)"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-white">{track.title}</div>
                  <div className="truncate text-[11.5px] text-white/50">{track.artist ?? "Unknown artist"}</div>
                </div>
                <span className="ff-mono text-[11px] text-white/40">{formatSeconds(track.durationSeconds)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Full-window Now Playing takeover: a compact player card on the left and a
 *  full-height Lyrics / Up Next panel on the right. */
function NowPlayingView() {
  const playback = useAppStore((state) => state.playback);
  const activeTrack = useAppStore(selectActiveTrack);
  const togglePlay = useAppStore((state) => state.togglePlay);
  const next = useAppStore((state) => state.next);
  const previous = useAppStore((state) => state.previous);
  const seek = useAppStore((state) => state.seek);
  const shuffle = useAppStore((state) => state.shuffle);
  const repeat = useAppStore((state) => state.repeat);
  const toggleShuffle = useAppStore((state) => state.toggleShuffle);
  const cycleRepeat = useAppStore((state) => state.cycleRepeat);
  const setView = useAppStore((state) => state.setView);

  const isPlaying = playback.status === "playing";
  const hasTrack = Boolean(playback.trackId);
  const duration = playback.durationSeconds ?? 0;

  const title = activeTrack?.title ?? playback.title ?? "Nothing playing";
  const artist = activeTrack?.artist ?? (hasTrack ? "Unknown artist" : "Pick a track to start");
  const sourceLine = activeTrack
    ? `${sourceLabel(activeTrack)}${activeTrack.album ? ` · ${activeTrack.album}` : ""}`
    : "Idle";

  const transport =
    "grid place-items-center rounded-lg text-white/75 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40";

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex w-[480px] shrink-0 flex-col px-10 py-9">
        <button
          className="absolute left-7 top-7 z-10 grid h-9 w-9 place-items-center rounded-xl text-white/55 transition hover:bg-white/[0.08] hover:text-white"
          onClick={() => setView("library")}
          title="Back to library"
          type="button"
        >
          <ChevronDown className="h-5 w-5" />
        </button>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
          <Equalizer
            tile={228}
            radius={20}
            gap={7}
            padBottom={64}
            barWidth={7}
            bars={[70, 40, 100, 58, 84, 46]}
            color={[ACCENT, ACCENT_SOFT]}
            animate={isPlaying}
            surface={{
              background: "rgba(255,255,255,.05)",
              border: "1px solid rgba(255,255,255,.12)",
              boxShadow: "0 36px 80px -36px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.12)"
            }}
          />

          <div className="w-full min-w-0 text-center">
            <div className="mb-3 flex items-center justify-center gap-2.5">
              <span className="ff-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: "#d8b27a" }}>
                Now Playing
              </span>
              <span className="h-[5px] w-[5px] rounded-full" style={{ background: ACCENT }} />
              <span className="max-w-[220px] truncate text-[12.5px] text-white/55">{sourceLine}</span>
            </div>
            <h1
              className="ff-display text-[32px] font-extrabold leading-[1.08] tracking-[-0.02em] text-white"
              style={{ overflowWrap: "anywhere" }}
            >
              {title}
            </h1>
            <div className="mt-2 text-[16px] text-white/60">{artist}</div>
          </div>

          <div className="flex w-full items-center gap-3.5">
            <span className="ff-mono text-[12px] text-white/45">{formatSeconds(playback.positionSeconds)}</span>
            <div className="flex-1">
              <Slider value={playback.positionSeconds} max={duration} disabled={!hasTrack || duration === 0} onChange={(value) => seek(value)} />
            </div>
            <span className="ff-mono text-[12px] text-white/45">{playback.durationSeconds ? formatSeconds(duration) : "--:--"}</span>
          </div>

          <div className="flex items-center gap-7 text-white">
          <button
            className={`${transport} h-10 w-10`}
            style={shuffle ? { color: ACCENT } : { color: "rgba(255,255,255,.75)" }}
            onClick={toggleShuffle}
            title="Shuffle"
            type="button"
          >
            <Shuffle className="h-[22px] w-[22px]" />
          </button>
          <button className={`${transport} h-11 w-11`} onClick={previous} disabled={!hasTrack} title="Previous" type="button">
            <SkipBack className="h-[26px] w-[26px] fill-current" />
          </button>
          <button
            className="accent-glow-lg grid h-[72px] w-[72px] place-items-center rounded-full text-white transition hover:brightness-110 active:scale-95 disabled:opacity-50"
            style={{ background: ACCENT }}
            onClick={togglePlay}
            disabled={!hasTrack}
            title={isPlaying ? "Pause" : "Play"}
            type="button"
          >
            {isPlaying ? <Pause className="h-7 w-7 fill-current" /> : <Play className="h-7 w-7 translate-x-[2px] fill-current" />}
          </button>
          <button className={`${transport} h-11 w-11`} onClick={next} disabled={!hasTrack} title="Next" type="button">
            <SkipForward className="h-[26px] w-[26px] fill-current" />
          </button>
          <button
            className={`${transport} h-10 w-10`}
            style={repeat !== "off" ? { color: ACCENT } : { color: "rgba(255,255,255,.75)" }}
            onClick={cycleRepeat}
            title={`Repeat: ${repeat}`}
            type="button"
          >
            {repeat === "one" ? <Repeat1 className="h-[22px] w-[22px]" /> : <Repeat className="h-[22px] w-[22px]" />}
          </button>
          </div>
        </div>
      </div>

      <NowPlayingPanel />
    </div>
  );
}

function DownloadsToast() {
  const downloads = useAppStore(selectActiveDownloads);
  if (downloads.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-28 right-6 z-40 flex w-80 flex-col gap-2">
      {downloads.map((job) => {
        const pct = job.totalBytes ? Math.min(100, Math.round((job.progressBytes / job.totalBytes) * 100)) : null;
        const indeterminate = job.status === "processing" || (job.status === "downloading" && pct === null);
        const barWidth = job.status === "complete" ? 100 : pct ?? 0;
        return (
          <div key={job.id} className="glass-strong amp-rise pointer-events-auto rounded-2xl p-3.5">
            <div className="mb-1.5 flex items-center gap-2">
              {job.status === "complete" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : job.status === "failed" ? (
                <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: ACCENT }} />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                {job.title ?? (job.kind === "external" ? "External download" : "Download")}
              </span>
              {job.status === "downloading" && pct !== null && (
                <span className="ff-mono text-xs text-white/50">{pct}%</span>
              )}
            </div>
            <div className="mb-2 truncate text-xs text-white/45">{job.error ?? job.stage ?? "Working…"}</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.1]">
              <div
                className={`h-full rounded-full transition-[width] ${indeterminate ? "w-full animate-pulse" : ""}`}
                style={{
                  background: job.status === "failed" ? "#f43f5e" : ACCENT,
                  ...(indeterminate ? {} : { width: `${barWidth}%` })
                }}
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
    <div className="amp-bg relative flex h-screen w-screen flex-col overflow-hidden text-white">
      <div className="amp-glow" style={{ width: 640, height: 640, left: -140, top: -160, background: "#5c4622", opacity: 0.42 }} />
      <div className="amp-glow" style={{ width: 540, height: 540, right: -100, bottom: -220, background: "#241d12", opacity: 0.55, filter: "blur(170px)" }} />

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <TitleBar />
        {view === "nowplaying" ? (
          <div key="nowplaying" className="amp-rise flex min-h-0 flex-1">
            <NowPlayingView />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <div className="flex min-h-0 flex-1 flex-col">
              <div key={view} className="amp-rise flex min-h-0 flex-1 flex-col">
                {view === "settings" ? <SettingsView /> : <LibraryView onRename={setRenameTarget} />}
              </div>
              <PlayerBar />
            </div>
          </div>
        )}
      </div>

      <DownloadsToast />
      <ResizeHandles />
      {renameTarget && <RenameDialog track={renameTarget} onClose={() => setRenameTarget(null)} />}
    </div>
  );
}
