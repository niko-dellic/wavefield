# Wavefield

Wavefield is a cymatic audio visualization playground with two implementations:

- `terminal/`: Rust CLI renderer for ANSI and Kitty-compatible terminals.
- `web/`: Vite + TypeScript + Three.js visual instrument with GPU shader rendering.

Shared audio fixtures live in `fixtures/audio/`. The web app imports the MP3
fixtures from `web/src/fixtures/audio/` so Vite can include them in the build
asset graph.

## Web Visualizer

The web app is the preferred high-FPS renderer. It uses Wavesurfer for waveform playback and scrubbing, Tweakpane for live controls, and a standalone Three.js cymatic accumulation pass adapted from the original Three.js pulse shader reference.

```sh
cd web
npm install
npm run dev
npm run build
npm run preview
```

The fixture buttons use normal Vite static asset imports from `web/src`, so dev,
build, and preview all resolve the same bundled audio URLs.

## Terminal Visualizer

```sh
cargo run -p wavefield -- "fixtures/audio/music for inst mix ab oz.mp3"
cargo run -p wavefield -- "fixtures/audio/music for inst mix ab oz.wav" --no-audio
cargo run -p wavefield -- "fixtures/audio/contradictions inst mix ab oz.mp3" --no-audio --frames 120
cargo run -p wavefield -- "fixtures/audio/music for inst mix ab oz.mp3" --backend kitty --quality medium --fps 15
cargo run -p wavefield -- "fixtures/audio/music for inst mix ab oz.mp3" --backend kitty --quality ultra --fps 8
```

`--backend ansi` is portable but cell-based. `--backend kitty` sends PNG-compressed raster frames through the terminal and is the preferred terminal backend in Kitty-compatible terminals.

Runtime keys:

- `Space`: pause or resume
- `[` / `]`: lower or raise sensitivity
- `-` / `=`: lower or raise gain
- `q`, `Esc`, or `Ctrl-C`: quit

## Tests

```sh
cargo test -p wavefield
cd web && npm run build
```

## Reference Material

This project ports ideas from local shader experiments, but does not depend on them at runtime:

- `../dotfiles/ghostty/shaders/cymatic_cursor.glsl`
- `../feel_the_agi_dataviz/src/lib/three/CymaticPulsePass.ts`

## License

Licensed under either of:

- MIT license
- Apache License, Version 2.0
