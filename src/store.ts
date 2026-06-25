import { create } from "zustand";
import type { AppSettings, DownloadProgress, LibraryRoot, PlaybackState, RepeatMode, Track, TrackSourceType } from "./types";
import * as api from "./tauri";

type SourceFilter = "all" | TrackSourceType | "missing" | "favorites";
export type View = "library" | "settings";

interface AppStore {
  tracks: Track[];
  libraryRoots: LibraryRoot[];
  playback: PlaybackState;
  downloads: Record<string, DownloadProgress>;
  settings: AppSettings | null;
  selectedTrackId: string | null;
  query: string;
  sourceFilter: SourceFilter;
  view: View;
  restartRequired: boolean;
  queue: string[];
  queueIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  busy: boolean;
  error: string | null;
  loadInitialData: () => Promise<void>;
  addFolders: () => Promise<void>;
  rescanRoot: (rootId: string) => Promise<void>;
  relinkRoot: (rootId: string) => Promise<void>;
  removeRoot: (rootId: string) => Promise<void>;
  deleteTrack: (trackId: string) => Promise<void>;
  importFiles: () => Promise<void>;
  addRemote: (url: string) => Promise<void>;
  downloadExternalSource: (url: string, rightsConfirmed: boolean) => Promise<void>;
  downloadTrack: (trackId: string) => Promise<void>;
  toggleFavorite: (trackId: string) => Promise<void>;
  renameTrack: (trackId: string, title: string, artist: string | null) => Promise<void>;
  changeDownloadsDir: () => Promise<void>;
  changeDataDir: () => Promise<void>;
  restartApp: () => Promise<void>;
  playTrack: (trackId: string) => Promise<void>;
  togglePlay: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  handleTrackEnded: () => Promise<void>;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  seek: (positionSeconds: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  refreshPlayback: () => Promise<void>;
  setQuery: (query: string) => void;
  setSourceFilter: (sourceFilter: SourceFilter) => void;
  setView: (view: View) => void;
  setPlayback: (playback: PlaybackState) => void;
  setDownloadProgress: (progress: DownloadProgress) => void;
  loadAndPlayInternal: (trackId: string) => Promise<void>;
}

const initialPlayback: PlaybackState = {
  status: "idle",
  trackId: null,
  title: null,
  positionSeconds: 0,
  durationSeconds: null,
  volume: 0.85,
  error: null
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function randomOtherIndex(length: number, current: number): number {
  if (length <= 1) return current;
  let next = current;
  while (next === current) {
    next = Math.floor(Math.random() * length);
  }
  return next;
}

export const useAppStore = create<AppStore>((set, get) => ({
  tracks: [],
  libraryRoots: [],
  playback: initialPlayback,
  downloads: {},
  settings: null,
  selectedTrackId: null,
  query: "",
  sourceFilter: "all",
  view: "library",
  restartRequired: false,
  queue: [],
  queueIndex: -1,
  shuffle: false,
  repeat: "off",
  busy: false,
  error: null,

  loadInitialData: async () => {
    set({ busy: true, error: null });
    try {
      const [tracks, libraryRoots, playback, settings] = await Promise.all([
        api.listTracks(),
        api.listLibraryRoots(),
        api.getPlaybackState(),
        api.getAppSettings().catch(() => null)
      ]);
      set({ tracks, libraryRoots, playback, settings, busy: false });
    } catch (error) {
      set({ error: messageFrom(error), busy: false });
    }
  },

  addFolders: async () => {
    set({ busy: true, error: null });
    try {
      const paths = await api.pickMusicFolders();
      for (const path of paths) {
        await api.addLibraryFolder(path);
      }
      const [tracks, libraryRoots] = await Promise.all([api.listTracks(), api.listLibraryRoots()]);
      set({ tracks, libraryRoots, busy: false });
    } catch (error) {
      set({ error: messageFrom(error), busy: false });
    }
  },

  rescanRoot: async (rootId) => {
    set({ busy: true, error: null });
    try {
      await api.rescanLibraryFolder(rootId);
      const [tracks, libraryRoots] = await Promise.all([api.listTracks(), api.listLibraryRoots()]);
      set({ tracks, libraryRoots, busy: false });
    } catch (error) {
      set({ error: messageFrom(error), busy: false });
    }
  },

  relinkRoot: async (rootId) => {
    set({ error: null });
    try {
      const path = await api.pickDirectory("Locate this folder on this device");
      if (!path) return;
      set({ busy: true });
      await api.relinkLibraryFolder(rootId, path);
      const [tracks, libraryRoots] = await Promise.all([api.listTracks(), api.listLibraryRoots()]);
      set({ tracks, libraryRoots, busy: false });
    } catch (error) {
      set({ error: messageFrom(error), busy: false });
    }
  },

  removeRoot: async (rootId) => {
    set({ busy: true, error: null });
    try {
      await api.removeLibraryFolder(rootId);
      const [tracks, libraryRoots] = await Promise.all([api.listTracks(), api.listLibraryRoots()]);
      set({ tracks, libraryRoots, busy: false });
    } catch (error) {
      set({ error: messageFrom(error), busy: false });
    }
  },

  deleteTrack: async (trackId) => {
    set({ busy: true, error: null });
    try {
      await api.deleteTrack(trackId);
      const [tracks, playback] = await Promise.all([api.listTracks(), api.getPlaybackState()]);
      set((state) => {
        const downloads = { ...state.downloads };
        delete downloads[trackId];

        return {
          tracks,
          playback,
          downloads,
          queue: state.queue.filter((id) => id !== trackId),
          selectedTrackId: state.selectedTrackId === trackId ? null : state.selectedTrackId,
          busy: false
        };
      });
    } catch (error) {
      set({ error: messageFrom(error), busy: false });
    }
  },

  importFiles: async () => {
    set({ busy: true, error: null });
    try {
      const paths = await api.pickAudioFiles();
      if (paths.length > 0) {
        await api.importLocalFiles(paths);
      }
      const tracks = await api.listTracks();
      set({ tracks, busy: false });
    } catch (error) {
      set({ error: messageFrom(error), busy: false });
    }
  },

  addRemote: async (url) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    set({ busy: true, error: null });
    try {
      const track = await api.addRemoteUrl(trimmed);
      set((state) => ({
        tracks: [track, ...state.tracks.filter((item) => item.id !== track.id)],
        selectedTrackId: track.id,
        busy: false
      }));
    } catch (error) {
      set({ error: messageFrom(error), busy: false });
    }
  },

  downloadExternalSource: async (url, rightsConfirmed) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    // The backend runs the download on its own thread and reports via events.
    set({ error: null });
    try {
      await api.downloadExternalSource(trimmed, rightsConfirmed);
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  downloadTrack: async (trackId) => {
    set({ error: null });
    try {
      await api.downloadTrack(trackId);
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  toggleFavorite: async (trackId) => {
    const current = get().tracks.find((track) => track.id === trackId);
    if (!current) return;
    try {
      const updated = await api.setFavorite(trackId, !current.favorite);
      set((state) => ({ tracks: state.tracks.map((track) => (track.id === trackId ? updated : track)) }));
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  renameTrack: async (trackId, title, artist) => {
    try {
      const updated = await api.renameTrack(trackId, title, artist);
      set((state) => ({
        tracks: state.tracks.map((track) => (track.id === trackId ? updated : track)),
        playback:
          state.playback.trackId === trackId ? { ...state.playback, title: updated.title } : state.playback
      }));
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  changeDownloadsDir: async () => {
    try {
      const path = await api.pickDirectory("Choose a downloads folder");
      if (!path) return;
      const settings = await api.setDownloadsDir(path);
      set({ settings });
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  changeDataDir: async () => {
    try {
      const path = await api.pickDirectory("Choose a data folder (e.g. a synced folder)");
      if (!path) return;
      const settings = await api.setDataDir(path);
      // Migration runs in the background and reports via the download toast;
      // the new location takes effect on restart.
      set({ settings, restartRequired: true });
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  restartApp: async () => {
    try {
      await api.restartApp();
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  playTrack: async (trackId) => {
    const ordered = selectFilteredTracks(get()).map((track) => track.id);
    const queue = ordered.includes(trackId) ? ordered : [trackId];
    set({ queue, queueIndex: queue.indexOf(trackId) });
    await get().loadAndPlayInternal(trackId);
  },

  loadAndPlayInternal: async (trackId) => {
    set({ selectedTrackId: trackId, error: null });
    try {
      await api.loadTrack(trackId);
      const playback = await api.play();
      set({ playback });
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  togglePlay: async () => {
    const { playback } = get();
    if (playback.status === "playing") {
      await get().pause();
    } else if (playback.trackId) {
      await get().play();
    } else if (get().queue.length > 0) {
      await get().loadAndPlayInternal(get().queue[Math.max(get().queueIndex, 0)]);
    }
  },

  play: async () => {
    try {
      set({ playback: await api.play() });
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  pause: async () => {
    try {
      set({ playback: await api.pause() });
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  stop: async () => {
    try {
      set({ playback: await api.stop() });
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  next: async () => {
    const { queue, queueIndex, shuffle, repeat } = get();
    if (queue.length === 0) return;

    let nextIndex: number;
    if (shuffle) {
      nextIndex = randomOtherIndex(queue.length, queueIndex);
    } else {
      nextIndex = queueIndex + 1;
      if (nextIndex >= queue.length) {
        if (repeat === "all") {
          nextIndex = 0;
        } else {
          return;
        }
      }
    }

    set({ queueIndex: nextIndex });
    await get().loadAndPlayInternal(queue[nextIndex]);
  },

  previous: async () => {
    const { queue, queueIndex, playback } = get();
    if (queue.length === 0) return;

    // Restart the current track if we're more than a few seconds in.
    if (playback.positionSeconds > 3 && playback.trackId) {
      await get().seek(0);
      return;
    }

    const prevIndex = queueIndex - 1;
    if (prevIndex < 0) {
      await get().seek(0);
      return;
    }
    set({ queueIndex: prevIndex });
    await get().loadAndPlayInternal(queue[prevIndex]);
  },

  handleTrackEnded: async () => {
    const { repeat, queue, queueIndex } = get();
    if (queue.length === 0 || queueIndex < 0) return;
    if (repeat === "one") {
      await get().loadAndPlayInternal(queue[queueIndex]);
      return;
    }
    await get().next();
  },

  toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
  cycleRepeat: () =>
    set((state) => ({ repeat: state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off" })),

  seek: async (positionSeconds) => {
    try {
      set({ playback: await api.seek(positionSeconds) });
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  setVolume: async (volume) => {
    try {
      set({ playback: await api.setVolume(volume) });
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  refreshPlayback: async () => {
    try {
      set({ playback: await api.getPlaybackState() });
    } catch (error) {
      set({ error: messageFrom(error) });
    }
  },

  setQuery: (query) => set({ query }),
  setSourceFilter: (sourceFilter) => set({ sourceFilter }),
  setView: (view) => set({ view }),
  setPlayback: (playback) => set({ playback }),
  setDownloadProgress: (progress) => {
    set((state) => ({
      downloads: { ...state.downloads, [progress.id]: progress }
    }));

    if (progress.status === "complete") {
      // The library changed (a track became offline, or a new one appeared).
      api.listTracks().then((tracks) => set({ tracks })).catch(() => {});
      window.setTimeout(() => {
        set((state) => {
          const downloads = { ...state.downloads };
          delete downloads[progress.id];
          return { downloads };
        });
      }, 3500);
    } else if (progress.status === "failed") {
      set({ error: progress.error ?? "Download failed" });
      window.setTimeout(() => {
        set((state) => {
          const downloads = { ...state.downloads };
          delete downloads[progress.id];
          return { downloads };
        });
      }, 6000);
    }
  }
}));

export function selectActiveDownloads(state: AppStore): DownloadProgress[] {
  return Object.values(state.downloads);
}

export function selectFilteredTracks(state: AppStore): Track[] {
  const query = state.query.trim().toLowerCase();

  return state.tracks.filter((track) => {
    const matchesSource =
      state.sourceFilter === "all"
        ? true
        : state.sourceFilter === "missing"
          ? track.missing
          : state.sourceFilter === "favorites"
            ? track.favorite
            : track.sourceType === state.sourceFilter;

    const searchable = [track.title, track.artist, track.album, track.fileName, track.path, track.url]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return matchesSource && (!query || searchable.includes(query));
  });
}

export function selectActiveTrack(state: AppStore): Track | undefined {
  return state.tracks.find((track) => track.id === state.playback.trackId);
}
