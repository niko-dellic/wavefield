use std::path::PathBuf;

use clap::{Parser, ValueEnum};

#[derive(Debug, Clone, Parser)]
#[command(version, about = "Render cymatic audio fields in the terminal.")]
pub struct Cli {
    pub audio_file: PathBuf,

    #[arg(long)]
    pub no_audio: bool,

    #[arg(long, value_enum, default_value_t = Mode::Cymatic)]
    pub mode: Mode,

    #[arg(long, value_enum, default_value_t = Backend::Ansi)]
    pub backend: Backend,

    #[arg(long, value_enum, default_value_t = PaletteName::Terminal)]
    pub palette: PaletteName,

    #[arg(long, default_value_t = 1.0)]
    pub gain: f32,

    #[arg(long, default_value_t = 1.0)]
    pub sensitivity: f32,

    #[arg(long)]
    pub fps: Option<f32>,

    #[arg(long, value_enum, default_value_t = Quality::Low)]
    pub quality: Quality,

    #[arg(long)]
    pub frames: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Mode {
    Cymatic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Backend {
    Ansi,
    Kitty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Quality {
    Low,
    Medium,
    High,
    Ultra,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum PaletteName {
    Terminal,
    Mono,
    Ember,
}
