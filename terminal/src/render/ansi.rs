use std::fmt::Write;

use crate::render::FrameBuffer;

pub fn render_blocks(frame: &FrameBuffer, gain: f32) -> String {
    let mut output = String::with_capacity(frame.width * frame.height * 24);
    let gain = gain.max(0.0);

    for y in 0..frame.height {
        for x in 0..frame.width {
            let bg = to_rgb(frame.get(x, y), gain);

            let _ = write!(output, "\x1b[48;2;{};{};{}m  ", bg[0], bg[1], bg[2]);
        }

        output.push_str("\x1b[0m\n");
    }

    output
}

fn to_rgb(color: [f32; 3], gain: f32) -> [u8; 3] {
    [
        to_channel(color[0], gain),
        to_channel(color[1], gain),
        to_channel(color[2], gain),
    ]
}

fn to_channel(value: f32, gain: f32) -> u8 {
    let mapped = 1.0 - (-value.max(0.0) * gain).exp();
    (mapped.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ansi_frame_is_non_empty() {
        let mut frame = FrameBuffer::new(2, 2);
        frame.set(0, 0, [1.0, 0.0, 0.0]);
        let rendered = render_blocks(&frame, 1.0);

        assert!(rendered.contains("  "));
        assert!(rendered.contains("\x1b[48;2;"));
    }
}
