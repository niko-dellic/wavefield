use anyhow::{Context, Result};

use crate::{
    analysis,
    audio::{self, Playback},
    cli::{Backend, Cli, Mode},
    palette::Palette,
    terminal::{self, RuntimeSettings},
};

pub fn run(cli: Cli) -> Result<()> {
    match cli.mode {
        Mode::Cymatic => {}
    }

    match cli.backend {
        Backend::Ansi => {}
    }

    let audio = audio::decode_file(&cli.audio_file)
        .with_context(|| format!("failed to decode {}", cli.audio_file.display()))?;
    let features = analysis::analyze(&audio);
    let playback = if cli.no_audio {
        None
    } else {
        Some(Playback::start(&audio)?)
    };

    terminal::run(
        &features,
        audio.duration(),
        Palette::from_name(cli.palette),
        RuntimeSettings {
            gain: cli.gain,
            sensitivity: cli.sensitivity,
            frame_limit: cli.frames,
        },
        playback,
    )
}
