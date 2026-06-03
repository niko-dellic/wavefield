use crate::{
    analysis::AudioFeatures,
    palette::{Palette, add_scaled, mix},
    pulse::Pulse,
    render::FrameBuffer,
};

pub fn render(
    frame: &mut FrameBuffer,
    time: f32,
    _features: AudioFeatures,
    pulses: &[Pulse],
    palette: Palette,
) {
    frame.clear(palette.background);

    let aspect = frame.width as f32 / frame.height.max(1) as f32;
    let pulse_energy = pulses
        .iter()
        .map(|pulse| pulse.envelope(time) * pulse.strength)
        .sum::<f32>()
        .clamp(0.0, 1.0);
    let source_energy = (0.08 + pulse_energy).clamp(0.0, 1.0);

    for y in 0..frame.height {
        for x in 0..frame.width {
            let uv = [
                ((x as f32 + 0.5) / frame.width as f32 * 2.0 - 1.0) * aspect,
                1.0 - (y as f32 + 0.5) / frame.height as f32 * 2.0,
            ];

            let mut color = palette.background;

            for pulse in pulses {
                shade_pulse(&mut color, uv, time, pulse, palette);
            }

            shade_source(&mut color, uv, source_energy, palette);
            frame.set(x, y, color);
        }
    }
}

fn shade_source(color: &mut [f32; 3], uv: [f32; 2], energy: f32, palette: Palette) {
    if energy <= 0.0 {
        return;
    }

    let distance = (uv[0] * uv[0] + uv[1] * uv[1]).sqrt();
    let core = 1.0 - smoothstep(0.0, 0.055, distance);
    let halo = 1.0 - smoothstep(0.03, 0.18, distance);
    add_scaled(color, palette.hot, energy * (core * 0.95 + halo * 0.16));
}

fn shade_pulse(color: &mut [f32; 3], uv: [f32; 2], time: f32, pulse: &Pulse, palette: Palette) {
    let age = pulse.age(time);
    let envelope = pulse.envelope(time);
    if envelope <= 0.0 {
        return;
    }

    let p = [uv[0] - pulse.origin[0], uv[1] - pulse.origin[1]];
    let distance = (p[0] * p[0] + p[1] * p[1]).sqrt();
    let angle = p[1].atan2(p[0]);
    let wave_radius = age * (0.34 + pulse.strength * 0.42 + pulse.low * 0.24);
    let ring_width = 0.035 + pulse.mid * 0.03;
    let ring = 1.0 - smoothstep(ring_width, ring_width * 4.0, (distance - wave_radius).abs());

    let symmetry = 5.0 + (pulse.centroid * 8.0).round();
    let density = 17.0 + pulse.low * 22.0 + pulse.high * 8.0;
    let drift = fbm([
        p[0] * (2.2 + pulse.high * 2.0) + time * 0.05,
        p[1] * (2.4 + pulse.mid * 1.8) - time * 0.04,
    ]) - 0.5;
    let radial_phase = distance * density - age * (7.5 + pulse.strength * 2.5) + drift * 1.2;
    let angular_wave = (angle * symmetry + pulse.seed * 6.28318).cos();
    let modal = radial_phase.sin() * (0.72 + angular_wave * 0.28);
    let harmonic = (radial_phase * (1.35 + pulse.mid * 1.4) + angular_wave * pulse.high).sin();
    let resonance = modal + harmonic * 0.42;
    let node = 1.0 - smoothstep(0.0, 0.085, resonance.abs());
    let body = (1.0 - resonance.abs()).clamp(0.0, 1.0).powf(2.0) * 0.11;
    let intensity = envelope * ring * (node.powf(1.2) * 0.92 + body) * pulse.strength.max(0.25);

    let base = mix(palette.low, palette.high, pulse.centroid);
    let hot = mix(base, palette.hot, node.powf(1.4));
    add_scaled(color, hot, intensity);
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    let t = ((value - edge0) / (edge1 - edge0).max(0.000_001)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn hash(p: [f32; 2]) -> f32 {
    ((p[0] * 127.1 + p[1] * 311.7).sin() * 43_758.547)
        .fract()
        .abs()
}

fn noise(p: [f32; 2]) -> f32 {
    let i = [p[0].floor(), p[1].floor()];
    let f = [p[0] - i[0], p[1] - i[1]];
    let u = [
        f[0] * f[0] * (3.0 - 2.0 * f[0]),
        f[1] * f[1] * (3.0 - 2.0 * f[1]),
    ];

    let a = hash([i[0], i[1]]);
    let b = hash([i[0] + 1.0, i[1]]);
    let c = hash([i[0], i[1] + 1.0]);
    let d = hash([i[0] + 1.0, i[1] + 1.0]);

    let x1 = a + (b - a) * u[0];
    let x2 = c + (d - c) * u[0];
    x1 + (x2 - x1) * u[1]
}

fn fbm(mut p: [f32; 2]) -> f32 {
    let mut value = 0.0;
    let mut amplitude = 0.5;

    for _ in 0..4 {
        value += amplitude * noise(p);
        p = [p[0] * 2.03 + 19.2, p[1] * 2.03 + 11.4];
        amplitude *= 0.5;
    }

    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::palette::Palette;

    #[test]
    fn persistent_source_marks_frame_center() {
        let palette = Palette::from_name(crate::cli::PaletteName::Mono);
        let mut frame = FrameBuffer::new(41, 21);

        render(&mut frame, 0.0, AudioFeatures::default(), &[], palette);

        let center = frame.get(frame.width / 2, frame.height / 2);
        let corner = frame.get(0, 0);
        assert!(center.iter().sum::<f32>() > corner.iter().sum::<f32>());
    }
}
