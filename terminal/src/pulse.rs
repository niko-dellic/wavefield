use crate::analysis::AudioFeatures;

const MAX_PULSES: usize = 64;
const PULSE_LIFETIME: f32 = 2.5;
const MIN_ONSET_GAP: f32 = 0.07;

#[derive(Debug, Clone)]
pub struct Pulse {
    pub started_at: f32,
    pub strength: f32,
    pub low: f32,
    pub mid: f32,
    pub high: f32,
    pub centroid: f32,
    pub seed: f32,
    pub origin: [f32; 2],
}

impl Pulse {
    pub fn age(&self, time: f32) -> f32 {
        (time - self.started_at).max(0.0)
    }

    pub fn envelope(&self, time: f32) -> f32 {
        let age = self.age(time);
        if age >= PULSE_LIFETIME {
            return 0.0;
        }

        let attack = (age / 0.08).clamp(0.0, 1.0);
        let decay = 1.0 - (age / PULSE_LIFETIME).powf(1.65);
        attack * decay.max(0.0)
    }

    pub fn is_alive(&self, time: f32) -> bool {
        self.envelope(time) > 0.001
    }
}

#[derive(Debug, Default)]
pub struct PulseField {
    pulses: Vec<Pulse>,
    last_onset_at: f32,
    seed_counter: u32,
}

impl PulseField {
    pub fn ingest(&mut self, features: AudioFeatures, sensitivity: f32) {
        let onset = (features.onset * sensitivity.max(0.0)).clamp(0.0, 1.5);

        if onset <= 0.08 || features.time - self.last_onset_at < MIN_ONSET_GAP {
            return;
        }

        self.last_onset_at = features.time;
        self.seed_counter = self.seed_counter.wrapping_add(1);
        let seed = hash(self.seed_counter as f32 * 12.9898 + features.time * 78.233);

        self.pulses.push(Pulse {
            started_at: features.time,
            strength: onset,
            low: features.low,
            mid: features.mid,
            high: features.high,
            centroid: features.centroid,
            seed,
            origin: [0.0, 0.0],
        });

        if self.pulses.len() > MAX_PULSES {
            let overflow = self.pulses.len() - MAX_PULSES;
            self.pulses.drain(0..overflow);
        }
    }

    pub fn update(&mut self, time: f32) {
        self.pulses.retain(|pulse| pulse.is_alive(time));
    }

    pub fn pulses(&self) -> &[Pulse] {
        &self.pulses
    }
}

fn hash(value: f32) -> f32 {
    (value.sin() * 43_758.547).fract().abs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pulse_expires_after_lifetime() {
        let mut field = PulseField::default();
        field.ingest(
            AudioFeatures {
                time: 1.0,
                onset: 1.0,
                rms: 1.0,
                ..Default::default()
            },
            1.0,
        );

        assert_eq!(field.pulses().len(), 1);
        field.update(4.0);
        assert!(field.pulses().is_empty());
    }

    #[test]
    fn pulse_count_is_capped() {
        let mut field = PulseField::default();

        for i in 0..100 {
            field.ingest(
                AudioFeatures {
                    time: i as f32 * 0.1,
                    onset: 1.0,
                    rms: 1.0,
                    ..Default::default()
                },
                1.0,
            );
        }

        assert!(field.pulses().len() <= MAX_PULSES);
    }

    #[test]
    fn pulses_spawn_at_screen_center() {
        let mut field = PulseField::default();
        field.ingest(
            AudioFeatures {
                time: 1.0,
                onset: 1.0,
                rms: 1.0,
                ..Default::default()
            },
            1.0,
        );

        assert_eq!(field.pulses()[0].origin, [0.0, 0.0]);
    }
}
