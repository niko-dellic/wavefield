use rustfft::{FftPlanner, num_complex::Complex};

use crate::audio::DecodedAudio;

pub const ANALYSIS_FPS: f32 = 60.0;

#[derive(Debug, Clone, Copy, Default)]
pub struct AudioFeatures {
    pub time: f32,
    pub rms: f32,
    pub low: f32,
    pub mid: f32,
    pub high: f32,
    pub centroid: f32,
    pub flux: f32,
    pub onset: f32,
}

pub fn analyze(audio: &DecodedAudio) -> Vec<AudioFeatures> {
    analyze_mono(&audio.mono, audio.sample_rate)
}

pub fn analyze_mono(mono: &[f32], sample_rate: u32) -> Vec<AudioFeatures> {
    if mono.is_empty() || sample_rate == 0 {
        return Vec::new();
    }

    let hop = ((sample_rate as f32 / ANALYSIS_FPS).round() as usize).max(1);
    let fft_size = (hop * 4).next_power_of_two().clamp(1024, 8192);
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    let window = hann_window(fft_size);
    let mut spectrum = vec![Complex::new(0.0, 0.0); fft_size];
    let mut previous = vec![0.0; fft_size / 2];
    let frame_count = mono.len().div_ceil(hop);
    let mut frames = Vec::with_capacity(frame_count);

    for frame_index in 0..frame_count {
        let start = frame_index * hop;
        let mut rms_acc = 0.0;

        for i in 0..fft_size {
            let sample = mono.get(start + i).copied().unwrap_or(0.0);
            rms_acc += sample * sample;
            spectrum[i] = Complex::new(sample * window[i], 0.0);
        }

        fft.process(&mut spectrum);

        let mut low = 0.0;
        let mut mid = 0.0;
        let mut high = 0.0;
        let mut low_bins = 0usize;
        let mut mid_bins = 0usize;
        let mut high_bins = 0usize;
        let mut flux = 0.0;
        let mut mag_sum = 0.0;
        let mut weighted_freq = 0.0;

        for bin in 1..(fft_size / 2) {
            let freq = bin as f32 * sample_rate as f32 / fft_size as f32;
            let mag = spectrum[bin].norm() / fft_size as f32;
            let positive_delta = (mag - previous[bin]).max(0.0);
            flux += positive_delta;
            previous[bin] = mag;

            if freq < 250.0 {
                low += mag;
                low_bins += 1;
            } else if freq < 4_000.0 {
                mid += mag;
                mid_bins += 1;
            } else {
                high += mag;
                high_bins += 1;
            }

            mag_sum += mag;
            weighted_freq += freq * mag;
        }

        let centroid = if mag_sum > 0.0 {
            (weighted_freq / mag_sum) / (sample_rate as f32 * 0.5)
        } else {
            0.0
        };

        frames.push(AudioFeatures {
            time: start as f32 / sample_rate as f32,
            rms: (rms_acc / fft_size as f32).sqrt(),
            low: average_band(low, low_bins),
            mid: average_band(mid, mid_bins),
            high: average_band(high, high_bins),
            centroid: centroid.clamp(0.0, 1.0),
            flux,
            onset: 0.0,
        });
    }

    mark_onsets(&mut frames);
    normalize_bands(&mut frames);
    frames
}

fn hann_window(size: usize) -> Vec<f32> {
    (0..size)
        .map(|i| {
            let phase = i as f32 / (size.saturating_sub(1).max(1)) as f32;
            0.5 - 0.5 * (std::f32::consts::TAU * phase).cos()
        })
        .collect()
}

fn mark_onsets(frames: &mut [AudioFeatures]) {
    let lookback = 18;

    for i in 0..frames.len() {
        if i < 3 {
            continue;
        }

        let start = i.saturating_sub(lookback);
        let history = &frames[start..i];
        let mean = history.iter().map(|frame| frame.flux).sum::<f32>() / history.len() as f32;
        let variance = history
            .iter()
            .map(|frame| {
                let delta = frame.flux - mean;
                delta * delta
            })
            .sum::<f32>()
            / history.len() as f32;
        let threshold = mean + variance.sqrt() * 1.65 + 0.000_001;

        if frames[i].flux > threshold && frames[i].rms > 0.002 {
            frames[i].onset = ((frames[i].flux - threshold) / threshold).clamp(0.0, 1.0);
        }
    }
}

fn normalize_bands(frames: &mut [AudioFeatures]) {
    let max_low = frames.iter().map(|frame| frame.low).fold(0.0, f32::max);
    let max_mid = frames.iter().map(|frame| frame.mid).fold(0.0, f32::max);
    let max_high = frames.iter().map(|frame| frame.high).fold(0.0, f32::max);
    let max_band = max_low.max(max_mid).max(max_high);

    for frame in frames {
        frame.low = normalize(frame.low, max_band);
        frame.mid = normalize(frame.mid, max_band);
        frame.high = normalize(frame.high, max_band);
    }
}

fn normalize(value: f32, max_value: f32) -> f32 {
    if max_value <= f32::EPSILON {
        0.0
    } else {
        (value / max_value).clamp(0.0, 1.0)
    }
}

fn average_band(value: f32, bins: usize) -> f32 {
    if bins == 0 { 0.0 } else { value / bins as f32 }
}

pub fn feature_at(frames: &[AudioFeatures], time: f32) -> AudioFeatures {
    if frames.is_empty() {
        return AudioFeatures::default();
    }

    let index = (time * ANALYSIS_FPS).floor().max(0.0) as usize;
    frames
        .get(index)
        .copied()
        .unwrap_or_else(|| *frames.last().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_energy_lands_in_low_band() {
        let sample_rate = 48_000;
        let samples: Vec<f32> = (0..sample_rate)
            .map(|i| (std::f32::consts::TAU * 110.0 * i as f32 / sample_rate as f32).sin() * 0.5)
            .collect();

        let frames = analyze_mono(&samples, sample_rate);
        let loud = frames
            .iter()
            .max_by(|a, b| a.low.total_cmp(&b.low))
            .expect("frames");

        assert!(loud.low > loud.mid);
        assert!(loud.low > loud.high);
    }

    #[test]
    fn click_creates_an_onset() {
        let sample_rate = 48_000;
        let mut samples = vec![0.0; sample_rate as usize];
        samples[sample_rate as usize / 3] = 1.0;
        samples[sample_rate as usize / 3 + 1] = -1.0;

        let frames = analyze_mono(&samples, sample_rate);
        assert!(frames.iter().any(|frame| frame.onset > 0.1));
    }
}
