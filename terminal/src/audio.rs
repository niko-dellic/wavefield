use std::{fs::File, num::NonZero, path::Path, time::Duration};

use anyhow::{Context, Result, anyhow, bail};
use rodio::{DeviceSinkBuilder, Player, buffer::SamplesBuffer};
use symphonia::core::{
    audio::{AudioBufferRef, SampleBuffer},
    codecs::{CODEC_TYPE_NULL, DecoderOptions},
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
};

#[derive(Debug, Clone)]
pub struct DecodedAudio {
    pub sample_rate: u32,
    pub channels: usize,
    pub samples: Vec<f32>,
    pub mono: Vec<f32>,
}

impl DecodedAudio {
    pub fn duration(&self) -> Duration {
        if self.sample_rate == 0 || self.channels == 0 {
            return Duration::ZERO;
        }

        let frames = self.samples.len() / self.channels;
        Duration::from_secs_f64(frames as f64 / self.sample_rate as f64)
    }
}

pub struct Playback {
    _sink: rodio::MixerDeviceSink,
    player: Player,
}

impl Playback {
    pub fn start(audio: &DecodedAudio) -> Result<Self> {
        let channels = NonZero::new(audio.channels as u16)
            .ok_or_else(|| anyhow!("decoded audio has zero channels"))?;
        let sample_rate = NonZero::new(audio.sample_rate)
            .ok_or_else(|| anyhow!("decoded audio has zero sample rate"))?;
        let source = SamplesBuffer::new(channels, sample_rate, audio.samples.clone());
        let sink = DeviceSinkBuilder::open_default_sink()
            .context("failed to open the default audio output device")?;
        let player = Player::connect_new(&sink.mixer());
        player.append(source);

        Ok(Self {
            _sink: sink,
            player,
        })
    }

    pub fn pause(&self) {
        self.player.pause();
    }

    pub fn play(&self) {
        self.player.play();
    }
}

pub fn decode_file(path: &Path) -> Result<DecodedAudio> {
    let file = File::open(path).with_context(|| format!("failed to open {}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|ext| ext.to_str()) {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .context("unsupported or unreadable audio format")?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("no supported audio track found"))?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("failed to create audio decoder")?;

    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(44_100);
    let mut channels = track
        .codec_params
        .channels
        .map(|channels| channels.count())
        .unwrap_or(1);
    let mut samples = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => bail!("decoder reset is not supported yet"),
            Err(err) => return Err(err).context("failed to read audio packet"),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(err) => return Err(err).context("failed to decode audio packet"),
        };

        let spec = *decoded.spec();
        sample_rate = spec.rate;
        channels = spec.channels.count().max(1);

        append_samples(&mut samples, decoded)?;
    }

    if samples.is_empty() {
        bail!("decoded audio had no samples");
    }

    let mono = to_mono(&samples, channels);

    Ok(DecodedAudio {
        sample_rate,
        channels,
        samples,
        mono,
    })
}

fn append_samples(samples: &mut Vec<f32>, decoded: AudioBufferRef<'_>) -> Result<()> {
    let spec = *decoded.spec();
    let duration = decoded.capacity() as u64;
    let mut sample_buffer = SampleBuffer::<f32>::new(duration, spec);
    sample_buffer.copy_interleaved_ref(decoded);
    samples.extend_from_slice(sample_buffer.samples());
    Ok(())
}

fn to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }

    samples
        .chunks(channels)
        .map(|frame| frame.iter().copied().sum::<f32>() / frame.len() as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_downmix_averages_channels() {
        let mono = to_mono(&[1.0, -1.0, 0.5, 0.25], 2);
        assert_eq!(mono, vec![0.0, 0.375]);
    }
}
