import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./tauri";
import { useAppStore } from "./store";
import type { PlaybackState, Track } from "./types";

vi.mock("./tauri", () => ({
  deleteTrack: vi.fn(),
  removeLibraryFolder: vi.fn(),
  listTracks: vi.fn(),
  listLibraryRoots: vi.fn(),
  getPlaybackState: vi.fn(),
  loadTrack: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn()
}));

function track(id: string): Track {
  return {
    id, title: id, sourceType: "local_file", artist: null, album: null,
    path: null, canonicalPath: null, url: null, fileName: null, extension: null,
    durationSeconds: null, missing: false, unsupported: false, libraryRootId: null,
    downloadStatus: null, createdAt: "", updatedAt: "", favorite: false, relativePath: null
  };
}

function playback(status: PlaybackState["status"], trackId: string | null = "b"): PlaybackState {
  return { ...useAppStore.getInitialState().playback, status, trackId, title: trackId };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    tracks: [track("a"), track("b"), track("c")],
    queue: ["a", "b", "c"], queueIndex: 1, selectedTrackId: "b",
    playback: playback("playing")
  });
  vi.mocked(api.getPlaybackState).mockResolvedValue(playback("playing"));
  vi.mocked(api.play).mockResolvedValue(playback("playing"));
});

describe("queue reconciliation", () => {
  it.each([
    ["a", ["b", "c"], 0, "b"],
    ["c", ["a", "b"], 1, "b"],
    ["b", ["a", "c"], 1, null]
  ] as const)("keeps the queue consistent after removing %s", async (removed, remaining, index, selected) => {
    vi.mocked(api.listTracks).mockResolvedValue(remaining.map(track));
    await useAppStore.getState().deleteTrack(removed);
    expect(useAppStore.getState()).toMatchObject({
      queue: [...remaining], queueIndex: index, selectedTrackId: selected, busy: false
    });
  });

  it("plays the next surviving track after deleting an earlier entry", async () => {
    vi.mocked(api.listTracks).mockResolvedValue([track("b"), track("c")]);
    await useAppStore.getState().deleteTrack("a");
    await useAppStore.getState().next();
    expect(api.loadTrack).toHaveBeenCalledWith("c");
  });

  it("starts the successor when the current track is deleted", async () => {
    vi.mocked(api.listTracks).mockResolvedValue([track("a"), track("c")]);
    vi.mocked(api.getPlaybackState).mockResolvedValue(playback("idle", null));
    await useAppStore.getState().deleteTrack("b");
    await useAppStore.getState().togglePlay();
    expect(api.loadTrack).toHaveBeenCalledWith("c");
  });

  it("clears queue and selection when a folder removes every track", async () => {
    vi.mocked(api.listTracks).mockResolvedValue([]);
    vi.mocked(api.listLibraryRoots).mockResolvedValue([]);
    vi.mocked(api.getPlaybackState).mockResolvedValue(playback("idle", null));
    await useAppStore.getState().removeRoot("root");
    expect(useAppStore.getState()).toMatchObject({
      queue: [], queueIndex: -1, selectedTrackId: null, playback: { status: "idle" }
    });
    await useAppStore.getState().togglePlay();
    expect(api.loadTrack).not.toHaveBeenCalled();
  });

  it("preserves the queue if deletion fails", async () => {
    vi.mocked(api.deleteTrack).mockRejectedValue(new Error("Cannot delete"));
    await useAppStore.getState().deleteTrack("a");
    expect(useAppStore.getState()).toMatchObject({ queue: ["a", "b", "c"], queueIndex: 1, error: "Cannot delete", busy: false });
  });

  it("keeps a valid index when the last queued track is deleted", async () => {
    useAppStore.setState({ queueIndex: 2, selectedTrackId: "c" });
    vi.mocked(api.listTracks).mockResolvedValue([track("a"), track("b")]);
    await useAppStore.getState().deleteTrack("c");
    expect(useAppStore.getState()).toMatchObject({ queue: ["a", "b"], queueIndex: 1, selectedTrackId: null });
  });

  it("suspends polling until a deletion finishes", async () => {
    const deleted = deferred<void>();
    vi.mocked(api.deleteTrack).mockReturnValue(deleted.promise);
    vi.mocked(api.listTracks).mockResolvedValue([track("b"), track("c")]);
    const deletion = useAppStore.getState().deleteTrack("a");
    await useAppStore.getState().refreshPlayback();
    expect(api.getPlaybackState).not.toHaveBeenCalled();
    deleted.resolve();
    await deletion;
    await useAppStore.getState().refreshPlayback();
    expect(api.getPlaybackState).toHaveBeenCalledTimes(2);
  });

  it("can shuffle a one-track queue with no current index", async () => {
    useAppStore.setState({ queue: ["a"], queueIndex: -1, shuffle: true });
    await useAppStore.getState().next();
    expect(api.loadTrack).toHaveBeenCalledWith("a");
  });
});

describe("playback lifecycle", () => {
  it("reloads a stopped track before playing", async () => {
    useAppStore.setState({ playback: playback("stopped") });
    await useAppStore.getState().togglePlay();
    expect(api.loadTrack).toHaveBeenCalledWith("b");
    expect(api.loadTrack).toHaveBeenCalledBefore(vi.mocked(api.play));
    expect(useAppStore.getState().playback.status).toBe("playing");
  });

  it("resumes a paused track without reloading it", async () => {
    useAppStore.setState({ playback: playback("paused") });
    await useAppStore.getState().togglePlay();
    expect(api.loadTrack).not.toHaveBeenCalled();
    expect(api.play).toHaveBeenCalledOnce();
  });

  it("does not play when reloading fails", async () => {
    useAppStore.setState({ playback: playback("stopped") });
    vi.mocked(api.loadTrack).mockRejectedValue(new Error("File missing"));
    await useAppStore.getState().play();
    expect(api.play).not.toHaveBeenCalled();
    expect(useAppStore.getState().error).toBe("File missing");
  });

  it("advances exactly once when overlapping polls see natural completion", async () => {
    const response = deferred<PlaybackState>();
    vi.mocked(api.getPlaybackState).mockReturnValue(response.promise);
    const first = useAppStore.getState().refreshPlayback();
    await useAppStore.getState().refreshPlayback();
    expect(api.getPlaybackState).toHaveBeenCalledOnce();
    response.resolve(playback("stopped"));
    await first;
    expect(api.loadTrack).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("does not advance after Stop interrupts a poll, even before Stop resolves", async () => {
    const response = deferred<PlaybackState>();
    const stopped = deferred<PlaybackState>();
    vi.mocked(api.getPlaybackState).mockReturnValue(response.promise);
    vi.mocked(api.stop).mockReturnValue(stopped.promise);
    const poll = useAppStore.getState().refreshPlayback();
    const stop = useAppStore.getState().stop();
    response.resolve(playback("stopped"));
    await poll;
    await useAppStore.getState().refreshPlayback();
    expect(api.getPlaybackState).toHaveBeenCalledOnce();
    expect(api.loadTrack).not.toHaveBeenCalled();
    stopped.resolve(playback("stopped"));
    await stop;
    expect(useAppStore.getState().playback.status).toBe("stopped");
  });

  it("ignores a poll superseded by a playback event", async () => {
    const response = deferred<PlaybackState>();
    vi.mocked(api.getPlaybackState).mockReturnValue(response.promise);
    const poll = useAppStore.getState().refreshPlayback();
    useAppStore.getState().setPlayback(playback("playing", "c"));
    response.resolve(playback("stopped"));
    await poll;
    expect(useAppStore.getState().playback.trackId).toBe("c");
    expect(api.loadTrack).not.toHaveBeenCalled();
  });

  it("allows another poll after a failed request", async () => {
    vi.mocked(api.getPlaybackState).mockRejectedValueOnce(new Error("Unavailable"));
    await useAppStore.getState().refreshPlayback();
    await useAppStore.getState().refreshPlayback();
    expect(api.getPlaybackState).toHaveBeenCalledTimes(2);
  });

  it.each(["off", "one", "all"] as const)("honors repeat %s at the end of the queue", async (repeat) => {
    useAppStore.setState({ queueIndex: 2, playback: playback("playing", "c"), repeat });
    vi.mocked(api.getPlaybackState).mockResolvedValue(playback("stopped", "c"));
    await useAppStore.getState().refreshPlayback();
    if (repeat === "off") {
      expect(api.loadTrack).not.toHaveBeenCalled();
      expect(useAppStore.getState().playback.status).toBe("stopped");
    } else {
      expect(api.loadTrack).toHaveBeenCalledWith(repeat === "one" ? "c" : "a");
    }
  });
});
