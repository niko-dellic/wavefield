# Wavefield

Wavefield is a terminal cymatic audio visualizer. It reads an audio file, detects onset energy, and renders cymatic pulse fields directly in the terminal.

The first renderer is deliberately portable: ANSI truecolor plus half-block cells. Higher fidelity terminal graphics backends can be added later without replacing the audio analysis or pulse simulation.

## Usage

```sh
cargo run -- path/to/song.mp3
cargo run -- path/to/song.mp3 --no-audio
cargo run -- path/to/song.mp3 --no-audio --frames 120
```

Local fixtures live in `fixtures/audio/`:

```sh
cargo run -- "fixtures/audio/music for inst mix ab oz.mp3"
cargo run -- "fixtures/audio/music for inst mix ab oz.wav" --no-audio
cargo run -- "fixtures/audio/contradictions inst mix ab oz.mp3" --no-audio --frames 120
```

Runtime keys:

- `Space`: pause or resume
- `[` / `]`: lower or raise sensitivity
- `-` / `=`: lower or raise gain
- `q`, `Esc`, or `Ctrl-C`: quit

## Reference Material

This project ports ideas from local shader experiments, but does not depend on them at runtime:

- `../dotfiles/ghostty/shaders/cymatic_cursor.glsl`
- `../feel_the_agi_dataviz/src/lib/three/CymaticPulsePass.ts`

## License

Licensed under either of:

- MIT license
- Apache License, Version 2.0
