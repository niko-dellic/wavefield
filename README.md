# Wavefield

<video src="./showcase/demo3.mp4" controls muted playsinline width="100%" title="Wavefield demo"></video>

[Watch the MP4 demo](./showcase/demo3.mp4)

Wavefield is a browser-based cymatic audio visualizer. It listens to music,
extracts frequency features, and turns them into Chladni-style modal patterns
rendered as an interactive GPU field with Three.js.

Use it as a visual instrument: load a bundled sample track or your own audio,
scrub the waveform, tune the modal field, switch between saved templates, and
shape the final output with post-processing effects.

## Features

- Audio-driven cymatic fields with frequency analysis and modal interpolation
- Screen and sphere projections with interactive Three.js rendering
- Bundled sample tracks plus local audio upload
- Waveform playback, scrubbing, and live diagnostics
- Template presets for quickly changing the visual language
- Post-processing controls for bloom, fisheye, pixelation, contouring, and trails

## Showcase

The template names below use the corresponding `showcase/` image filename.

| Template | Preview |
| --- | --- |
| `default` | <img src="./showcase/default.png" alt="default template preview" width="420"> |
| `microsoft-excel` | <img src="./showcase/microsoft-excel.png" alt="microsoft-excel template preview" width="420"> |
| `infection` | <img src="./showcase/infection.png" alt="infection template preview" width="420"> |
| `alien` | <img src="./showcase/alien.png" alt="alien template preview" width="420"> |
| `knicks` | <img src="./showcase/knicks.png" alt="knicks template preview" width="420"> |
| `lightning` | <img src="./showcase/lightning.png" alt="lightning template preview" width="420"> |
| `grid` | <img src="./showcase/grid.png" alt="grid template preview" width="420"> |
| `matrix` | <img src="./showcase/matrix.png" alt="matrix template preview" width="420"> |
| `diablo` | <img src="./showcase/diablo.png" alt="diablo template preview" width="420"> |
| `green-flame` | <img src="./showcase/green-flame.png" alt="green-flame template preview" width="420"> |
| `black-on-red` | <img src="./showcase/black-on-red.png" alt="black-on-red template preview" width="420"> |

## Run Locally

```sh
npm install
npm run dev
```

Build and preview the production bundle:

```sh
npm run build
npm run preview
```

## Templates And Audio

Wavefield loads templates from `src/templates/`. In development, the app can
save, resave, and delete templates through the local Vite middleware.

Sample MP3 files live in `src/fixtures/audio/`. They are imported through Vite
so production builds receive fingerprinted asset URLs instead of hardcoded file
paths.

## Tests

```sh
npm run build
npm run test:analysis
```

## License

Licensed under either of:

- MIT license
- Apache License, Version 2.0
