use std::{fs::File, path::PathBuf, time::Duration};

use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};

use crate::models::PlaybackSnapshot;

pub struct AudioPlayer {
    sink_handle: MixerDeviceSink,
    player: Option<Player>,
    status: String,
    track_id: Option<String>,
    title: Option<String>,
    duration_seconds: Option<f64>,
    volume: f32,
    error: Option<String>,
}

impl AudioPlayer {
    pub fn new() -> Result<Self, String> {
        let sink_handle = DeviceSinkBuilder::open_default_sink().map_err(|error| format!("Cannot open audio output: {error}"))?;
        Ok(Self {
            sink_handle,
            player: None,
            status: "idle".to_string(),
            track_id: None,
            title: None,
            duration_seconds: None,
            volume: 0.85,
            error: None,
        })
    }

    pub fn load_file(&mut self, track_id: &str, title: &str, path: PathBuf) -> Result<PlaybackSnapshot, String> {
        let file = File::open(&path).map_err(|error| format!("Cannot open track: {error}"))?;
        let source = Decoder::try_from(file).map_err(|error| format!("Cannot decode track: {error}"))?;
        let duration_seconds = source.total_duration().map(|duration| duration.as_secs_f64());
        let player = Player::connect_new(&self.sink_handle.mixer());
        player.set_volume(self.volume);
        player.append(source);
        player.pause();

        self.player = Some(player);
        self.status = "loaded".to_string();
        self.track_id = Some(track_id.to_string());
        self.title = Some(title.to_string());
        self.duration_seconds = duration_seconds;
        self.error = None;

        Ok(self.snapshot())
    }

    pub fn play(&mut self) -> PlaybackSnapshot {
        if let Some(player) = &self.player {
            player.play();
            self.status = "playing".to_string();
            self.error = None;
        }
        self.snapshot()
    }

    pub fn pause(&mut self) -> PlaybackSnapshot {
        if let Some(player) = &self.player {
            player.pause();
            self.status = "paused".to_string();
            self.error = None;
        }
        self.snapshot()
    }

    pub fn stop(&mut self) -> PlaybackSnapshot {
        if let Some(player) = &self.player {
            player.stop();
        }
        self.status = "stopped".to_string();
        self.error = None;
        self.snapshot()
    }

    pub fn clear(&mut self) -> PlaybackSnapshot {
        if let Some(player) = &self.player {
            player.stop();
        }
        self.player = None;
        self.status = "idle".to_string();
        self.track_id = None;
        self.title = None;
        self.duration_seconds = None;
        self.error = None;
        self.snapshot()
    }

    pub fn seek(&mut self, position_seconds: f64) -> Result<PlaybackSnapshot, String> {
        if let Some(player) = &self.player {
            player
                .try_seek(Duration::from_secs_f64(position_seconds.max(0.0)))
                .map_err(|error| format!("Seek failed: {error}"))?;
        }
        Ok(self.snapshot())
    }

    pub fn set_volume(&mut self, volume: f32) -> PlaybackSnapshot {
        self.volume = volume;
        if let Some(player) = &self.player {
            player.set_volume(volume);
        }
        self.snapshot()
    }

    pub fn snapshot(&mut self) -> PlaybackSnapshot {
        if self.status == "playing" && self.player.as_ref().map(|player| player.empty()).unwrap_or(false) {
            self.status = "stopped".to_string();
        }

        let position_seconds = self
            .player
            .as_ref()
            .map(|player| player.get_pos().as_secs_f64())
            .unwrap_or(0.0);

        PlaybackSnapshot {
            status: self.status.clone(),
            track_id: self.track_id.clone(),
            title: self.title.clone(),
            position_seconds,
            duration_seconds: self.duration_seconds,
            volume: self.volume,
            error: self.error.clone(),
        }
    }
}
