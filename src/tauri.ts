import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppSettings, DownloadProgress, ExternalSourceProbe, LibraryRoot, PlaybackState, ScanSummary, Track, YtDlpStatus } from "./types";

export async function listTracks(): Promise<Track[]> {
  return invoke("list_tracks");
}

export async function getAppSettings(): Promise<AppSettings> {
  return invoke("get_app_settings");
}

export async function setDownloadsDir(path: string): Promise<AppSettings> {
  return invoke("set_downloads_dir", { path });
}

export async function setDataDir(path: string): Promise<AppSettings> {
  return invoke("set_data_dir", { path });
}

export async function restartApp(): Promise<void> {
  return invoke("restart_app");
}

export async function setFavorite(trackId: string, favorite: boolean): Promise<Track> {
  return invoke("set_favorite", { trackId, favorite });
}

export async function renameTrack(trackId: string, title: string, artist: string | null): Promise<Track> {
  return invoke("rename_track", { trackId, title, artist });
}

export async function listLibraryRoots(): Promise<LibraryRoot[]> {
  return invoke("list_library_roots");
}

export async function addLibraryFolder(path: string): Promise<ScanSummary> {
  return invoke("add_library_folder", { path });
}

export async function rescanLibraryFolder(rootId: string): Promise<ScanSummary> {
  return invoke("rescan_library_folder", { rootId });
}

export async function relinkLibraryFolder(rootId: string, path: string): Promise<ScanSummary> {
  return invoke("relink_library_folder", { rootId, path });
}

export async function removeLibraryFolder(rootId: string): Promise<void> {
  return invoke("remove_library_folder", { rootId });
}

export async function deleteTrack(trackId: string): Promise<void> {
  return invoke("delete_track", { trackId });
}

export async function importLocalFiles(paths: string[]): Promise<Track[]> {
  return invoke("import_local_files", { paths });
}

export async function addRemoteUrl(url: string): Promise<Track> {
  return invoke("add_remote_url", { url });
}

export async function checkYtDlp(): Promise<YtDlpStatus> {
  return invoke("check_ytdlp");
}

export async function probeExternalSource(url: string): Promise<ExternalSourceProbe> {
  return invoke("probe_external_source", { url });
}

export async function downloadExternalSource(url: string, rightsConfirmed: boolean): Promise<void> {
  return invoke("download_external_source", { url, rightsConfirmed });
}

export async function downloadTrack(trackId: string): Promise<void> {
  return invoke("download_track", { trackId });
}

export async function loadTrack(trackId: string): Promise<PlaybackState> {
  return invoke("load_track", { trackId });
}

export async function play(): Promise<PlaybackState> {
  return invoke("play");
}

export async function pause(): Promise<PlaybackState> {
  return invoke("pause");
}

export async function stop(): Promise<PlaybackState> {
  return invoke("stop");
}

export async function seek(positionSeconds: number): Promise<PlaybackState> {
  return invoke("seek", { positionSeconds });
}

export async function setVolume(volume: number): Promise<PlaybackState> {
  return invoke("set_volume", { volume });
}

export async function getPlaybackState(): Promise<PlaybackState> {
  return invoke("get_playback_state");
}

export async function pickMusicFolders(): Promise<string[]> {
  const selected = await open({
    directory: true,
    multiple: true,
    title: "Choose music folders"
  });

  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function pickDirectory(title: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title });
  if (!selected) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

export async function pickAudioFiles(): Promise<string[]> {
  const selected = await open({
    directory: false,
    multiple: true,
    title: "Choose audio files",
    filters: [
      {
        name: "Audio",
        extensions: ["mp3", "m4a", "aac", "flac", "ogg", "wav"]
      }
    ]
  });

  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export function listenPlayback(handler: (state: PlaybackState) => void) {
  return listen<PlaybackState>("playback-state", (event) => handler(event.payload));
}

export function listenDownloadProgress(handler: (progress: DownloadProgress) => void) {
  return listen<DownloadProgress>("download-progress", (event) => handler(event.payload));
}
