use std::fmt::Write;

use base64::{Engine, engine::general_purpose::STANDARD};
use png::{BitDepth, ColorType, Encoder};

use crate::render::FrameBuffer;

const IMAGE_ID: u32 = 84_901;
const PLACEMENT_ID: u32 = 1;
const CHUNK_SIZE: usize = 4096;

pub fn render_image(frame: &FrameBuffer, columns: u16, rows: u16, gain: f32) -> String {
    let png = encode_png(frame, gain).expect("encoding PNG frame into memory failed");
    let encoded = STANDARD.encode(png);
    let mut output = String::with_capacity(encoded.len() + encoded.len() / CHUNK_SIZE * 96);
    let mut chunks = encoded.as_bytes().chunks(CHUNK_SIZE).peekable();
    let mut first = true;

    while let Some(chunk) = chunks.next() {
        let more = if chunks.peek().is_some() { 1 } else { 0 };
        let data = std::str::from_utf8(chunk).expect("base64 is utf8");

        if first {
            let _ = write!(
                output,
                "\x1b_Ga=T,q=2,i={IMAGE_ID},p={PLACEMENT_ID},f=100,c={},r={},m={more};{data}\x1b\\",
                columns.max(1),
                rows.max(1),
            );
            first = false;
        } else {
            let _ = write!(output, "\x1b_Gq=2,m={more};{data}\x1b\\");
        }
    }

    output
}

fn encode_png(frame: &FrameBuffer, gain: f32) -> Result<Vec<u8>, png::EncodingError> {
    let mut rgb = Vec::with_capacity(frame.width * frame.height * 3);
    let gain = gain.max(0.0);

    for y in 0..frame.height {
        for x in 0..frame.width {
            rgb.extend_from_slice(&to_rgb(frame.get(x, y), gain));
        }
    }

    let mut png = Vec::new();
    {
        let mut encoder = Encoder::new(&mut png, frame.width as u32, frame.height as u32);
        encoder.set_color(ColorType::Rgb);
        encoder.set_depth(BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(&rgb)?;
    }

    Ok(png)
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
    fn emits_kitty_graphics_sequence() {
        let mut frame = FrameBuffer::new(2, 2);
        frame.set(1, 1, [1.0, 0.0, 0.0]);
        let output = render_image(&frame, 10, 5, 1.0);

        assert!(output.starts_with("\x1b_Ga=T"));
        assert!(output.contains("f=100"));
        assert!(output.ends_with("\x1b\\"));
    }

    #[test]
    fn png_payload_is_smaller_than_raw_rgb_for_sparse_frame() {
        let mut frame = FrameBuffer::new(160, 96);
        frame.set(80, 48, [1.0, 1.0, 1.0]);

        let png = encode_png(&frame, 1.0).expect("png");
        let raw_rgb_len = frame.width * frame.height * 3;

        assert!(png.len() < raw_rgb_len / 4);
    }
}
