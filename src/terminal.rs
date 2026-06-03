use std::{
    io::{self, IsTerminal, Write},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail};
use crossterm::{
    cursor,
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute, queue,
    style::Print,
    terminal::{self, EnterAlternateScreen, LeaveAlternateScreen},
};

use crate::{
    analysis::{AudioFeatures, feature_at},
    palette::Palette,
    pulse::PulseField,
    render::{FrameBuffer, ansi, cymatic},
};

pub struct RuntimeSettings {
    pub gain: f32,
    pub sensitivity: f32,
    pub frame_limit: Option<u32>,
}

pub fn run(
    features: &[AudioFeatures],
    duration: Duration,
    palette: Palette,
    settings: RuntimeSettings,
    playback: Option<crate::audio::Playback>,
) -> Result<()> {
    if !io::stdout().is_terminal() {
        if let Some(frames) = settings.frame_limit {
            return render_headless(features, palette, settings.gain, frames);
        }

        bail!("wavefield needs a TTY unless --frames is provided");
    }

    let mut session = TerminalSession::enter()?;
    let mut settings = settings;
    let mut pulses = PulseField::default();
    let mut next_feature = 0usize;
    let mut last_features = AudioFeatures::default();
    let mut visual_time = 0.0f32;
    let mut rendered_frames = 0u32;
    let mut paused = false;
    let mut last_tick = Instant::now();
    let frame_time = Duration::from_secs_f32(1.0 / 30.0);

    loop {
        let tick_started = Instant::now();
        let delta = tick_started.saturating_duration_since(last_tick);
        last_tick = tick_started;

        if handle_input(&mut paused, &mut settings, playback.as_ref())? {
            break;
        }

        if !paused {
            visual_time += delta.as_secs_f32();

            while next_feature < features.len() && features[next_feature].time <= visual_time {
                last_features = features[next_feature];
                pulses.ingest(last_features, settings.sensitivity);
                next_feature += 1;
            }
        }

        pulses.update(visual_time);
        draw_frame(
            session.stdout_mut(),
            visual_time,
            last_features,
            &pulses,
            palette,
            settings.gain,
        )?;
        rendered_frames += 1;

        if settings
            .frame_limit
            .is_some_and(|limit| rendered_frames >= limit)
        {
            break;
        }

        if visual_time > duration.as_secs_f32() + 2.6 && pulses.pulses().is_empty() {
            break;
        }

        let elapsed = tick_started.elapsed();
        if elapsed < frame_time {
            std::thread::sleep(frame_time - elapsed);
        }
    }

    Ok(())
}

fn handle_input(
    paused: &mut bool,
    settings: &mut RuntimeSettings,
    playback: Option<&crate::audio::Playback>,
) -> Result<bool> {
    while event::poll(Duration::from_millis(0)).context("failed to poll terminal input")? {
        let Event::Key(key) = event::read().context("failed to read terminal input")? else {
            continue;
        };

        if key.kind != KeyEventKind::Press {
            continue;
        }

        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => return Ok(true),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => return Ok(true),
            KeyCode::Char(' ') => {
                *paused = !*paused;
                if let Some(playback) = playback {
                    if *paused {
                        playback.pause();
                    } else {
                        playback.play();
                    }
                }
            }
            KeyCode::Char('[') => settings.sensitivity = (settings.sensitivity * 0.9).max(0.05),
            KeyCode::Char(']') => settings.sensitivity = (settings.sensitivity * 1.1).min(8.0),
            KeyCode::Char('-') => settings.gain = (settings.gain * 0.9).max(0.05),
            KeyCode::Char('=') => settings.gain = (settings.gain * 1.1).min(8.0),
            _ => {}
        }
    }

    Ok(false)
}

fn draw_frame(
    stdout: &mut io::Stdout,
    time: f32,
    features: AudioFeatures,
    pulses: &PulseField,
    palette: Palette,
    gain: f32,
) -> Result<()> {
    let (cols, rows) = terminal::size().unwrap_or((80, 24));
    let width = cols.max(20) as usize;
    let height = rows.saturating_sub(1).max(10) as usize * 2;
    let mut frame = FrameBuffer::new(width, height);
    cymatic::render(&mut frame, time, features, pulses.pulses(), palette);
    let ansi = ansi::render_half_blocks(&frame, gain);

    queue!(stdout, cursor::MoveTo(0, 0), Print(ansi)).context("failed to queue frame")?;
    stdout.flush().context("failed to flush frame")?;
    Ok(())
}

fn render_headless(
    features: &[AudioFeatures],
    palette: Palette,
    gain: f32,
    frames: u32,
) -> Result<()> {
    let mut stdout = io::stdout();
    let mut pulses = PulseField::default();
    let mut next_feature = 0usize;
    let mut last_features = AudioFeatures::default();
    let mut time = 0.0f32;

    for _ in 0..frames {
        while next_feature < features.len() && features[next_feature].time <= time {
            last_features = features[next_feature];
            pulses.ingest(last_features, 1.0);
            next_feature += 1;
        }

        pulses.update(time);
        let mut frame = FrameBuffer::new(80, 48);
        let render_features = if last_features.time > 0.0 {
            last_features
        } else {
            feature_at(features, time)
        };
        cymatic::render(&mut frame, time, render_features, pulses.pulses(), palette);
        stdout
            .write_all(ansi::render_half_blocks(&frame, gain).as_bytes())
            .context("failed to write headless frame")?;
        time += 1.0 / 30.0;
    }

    Ok(())
}

struct TerminalSession {
    stdout: io::Stdout,
}

impl TerminalSession {
    fn enter() -> Result<Self> {
        let mut stdout = io::stdout();
        execute!(
            stdout,
            EnterAlternateScreen,
            cursor::Hide,
            terminal::Clear(terminal::ClearType::All)
        )
        .context("failed to enter terminal screen")?;
        terminal::enable_raw_mode().context("failed to enable raw mode")?;
        Ok(Self { stdout })
    }

    fn stdout_mut(&mut self) -> &mut io::Stdout {
        &mut self.stdout
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        let _ = terminal::disable_raw_mode();
        let _ = execute!(self.stdout, cursor::Show, LeaveAlternateScreen);
    }
}
