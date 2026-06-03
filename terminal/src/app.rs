use std::time::Instant;

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
        Backend::Kitty => {}
    }

    let started = Instant::now();
    eprintln!("wavefield: decoding {}", cli.audio_file.display());
    let audio = audio::decode_file(&cli.audio_file)
        .with_context(|| format!("failed to decode {}", cli.audio_file.display()))?;
    eprintln!(
        "wavefield: decoded {:.1}s in {:.2}s",
        audio.duration().as_secs_f32(),
        started.elapsed().as_secs_f32()
    );

    let analysis_started = Instant::now();
    eprintln!("wavefield: analyzing audio");
    let features = analysis::analyze(&audio);
    eprintln!(
        "wavefield: analyzed {} frames in {:.2}s",
        features.len(),
        analysis_started.elapsed().as_secs_f32()
    );

    let playback = if cli.no_audio {
        None
    } else {
        eprintln!("wavefield: opening audio output");
        Some(Playback::start(&audio)?)
    };

    terminal::run(
        &features,
        audio.duration(),
        Palette::from_name(cli.palette),
        RuntimeSettings {
            backend: cli.backend,
            fps: cli.fps,
            gain: cli.gain,
            quality: cli.quality,
            sensitivity: cli.sensitivity,
            frame_limit: cli.frames,
        },
        playback,
    )
}
