export type TrackSourceType = "library_file" | "local_file" | "remote_url" | "downloaded_file";
export type DownloadStatus = "queued" | "downloading" | "paused" | "complete" | "failed" | "cancelled";
export type PlaybackStatus = "idle" | "loaded" | "playing" | "paused" | "stopped" | "error";

export interface LibraryRoot {
  id: string;
  path: string;
  canonicalPath: string;
  addedAt: string;
  lastScannedAt: string | null;
}

export interface Track {
  id: string;
  sourceType: TrackSourceType;
  title: string;
  artist: string | null;
  album: string | null;
  path: string | null;
  canonicalPath: string | null;
  url: string | null;
  fileName: string | null;
  extension: string | null;
  durationSeconds: number | null;
  missing: boolean;
  unsupported: boolean;
  libraryRootId: string | null;
  downloadStatus: DownloadStatus | null;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  relativePath: string | null;
}

export interface AppSettings {
  downloadsDir: string;
  defaultDownloadsDir: string;
  dataDir: string;
  defaultDataDir: string;
}

export type RepeatMode = "off" | "all" | "one";

export interface ScanSummary {
  rootId: string;
  scanned: number;
  added: number;
  updated: number;
  missing: number;
  unsupported: number;
}

export interface PlaybackState {
  status: PlaybackStatus;
  trackId: string | null;
  title: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  volume: number;
  error: string | null;
}

export type DownloadJobStatus = "downloading" | "processing" | "complete" | "failed";

export interface DownloadProgress {
  /** Track id for direct downloads, or a temporary job id for external downloads. */
  id: string;
  kind: "remote" | "external" | "migrate";
  title: string | null;
  status: DownloadJobStatus;
  stage: string | null;
  progressBytes: number;
  totalBytes: number | null;
  error: string | null;
}

export interface YtDlpStatus {
  available: boolean;
  path: string;
  version: string | null;
  error: string | null;
}

/** Raw lyrics payload from the backend (LRCLIB lookup). */
export interface RawLyrics {
  synced: string | null;
  plain: string | null;
  source: string;
  trackName: string | null;
  artistName: string | null;
}

/** One timestamped line parsed from synced LRC lyrics. */
export interface LyricLine {
  time: number;
  text: string;
}

/** Per-track lyrics state held in the store. */
export interface LyricsEntry {
  status: "loading" | "ready" | "error";
  synced: LyricLine[] | null;
  plain: string | null;
  source: string | null;
  error: string | null;
}

export interface ExternalSourceProbe {
  url: string;
  webpageUrl: string | null;
  title: string;
  extractor: string | null;
  extractorKey: string | null;
  uploader: string | null;
  license: string | null;
  durationSeconds: number | null;
}
