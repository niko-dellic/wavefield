# Wavefield

Wavefield is a web-based cymatic audio visualization playground. It listens to
music, maps audio features into Chladni-style modal patterns, and renders the
result as an interactive GPU-driven field with Three.js.

The app is built with Vite, TypeScript, Three.js, Wavesurfer, and Tweakpane. It
includes bundled sample tracks, waveform playback and scrubbing, live rendering
controls, and post-processing effects for shaping the visual instrument.

## Run Locally

```sh
cd web
npm install
npm run dev
```

Build and preview the production bundle:

```sh
npm run build
npm run preview
```

## Sample Audio

Wavefield imports sample MP3 files from `web/src/fixtures/audio/` so Vite can
include them in the build asset graph. The in-app fixture buttons use those
bundled URLs in development, production builds, and preview mode.

You can add your own MP3 files to that directory to expose more bundled sample
tracks in the app.

## Tests

```sh
cd web
npm run build
npm run test:analysis
```

## Visualization Model

Wavefield focuses on cymatic motion: frequency analysis drives a modal field
that favors standing-wave, nodal-line behavior over generic audio-reactive
ripples. The renderer supports both screen-space and sphere projections, with
controls for modal density, harmonic mix, chromesthesia, post-processing, and
audio sensitivity.

## License

Licensed under either of:

- MIT license
- Apache License, Version 2.0
