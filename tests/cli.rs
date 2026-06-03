use std::{
    fs::File,
    io::{self, Write},
    path::Path,
    process::Command,
};

#[test]
fn renders_three_silent_frames() {
    let temp = std::env::temp_dir().join(format!("wavefield-test-{}.wav", std::process::id()));
    write_test_wav(&temp).expect("write wav");

    let output = Command::new(env!("CARGO_BIN_EXE_wavefield"))
        .arg(&temp)
        .arg("--no-audio")
        .arg("--frames")
        .arg("3")
        .output()
        .expect("run wavefield");

    let _ = std::fs::remove_file(&temp);

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("\x1b[48;2;"));
    assert!(stdout.contains("  "));
}

fn write_test_wav(path: &Path) -> io::Result<()> {
    let sample_rate = 8_000u32;
    let samples: Vec<i16> = (0..sample_rate / 2)
        .map(|i| {
            let t = i as f32 / sample_rate as f32;
            ((std::f32::consts::TAU * 220.0 * t).sin() * i16::MAX as f32 * 0.25) as i16
        })
        .collect();

    let mut file = File::create(path)?;
    let data_len = samples.len() as u32 * 2;
    let riff_len = 36 + data_len;

    file.write_all(b"RIFF")?;
    file.write_all(&riff_len.to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&(sample_rate * 2).to_le_bytes())?;
    file.write_all(&2u16.to_le_bytes())?;
    file.write_all(&16u16.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_len.to_le_bytes())?;

    for sample in samples {
        file.write_all(&sample.to_le_bytes())?;
    }

    Ok(())
}
