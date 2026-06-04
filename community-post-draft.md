# Wavefield Community Post Draft

Local-only draft. This file is listed in `.gitignore` and should not be
committed.

Repo: https://github.com/niko-dellic/wavefield
Demo/media: use the README WebP preview, a short screen recording, or a hosted
demo link if one is available.

## Good Places To Post

- Reddit: `r/creativecoding`, `r/generative`, `r/threejs`, and possibly
  `r/webgl` if the post leans more technical.
- Three.js forum: Showcase category:
  https://discourse.threejs.org/c/showcase
- TouchDesigner-adjacent / AV communities: Derivative forum community posts,
  creative coding Discords, Processing Foundation forum, ShaderToy community,
  Cycling '74 / Max MSP forum if you frame it around audio-reactive visuals.
- Avoid broad programming communities unless you write a more technical post
  about Web Audio analysis, Chladni/modal-field rendering, or Three.js shader
  architecture.

## Reddit Title Options

- I built Wavefield, a browser-based cymatic audio visualizer with Three.js
- Wavefield: audio-reactive Chladni-style visuals running in the browser
- I made a visual instrument for turning music into cymatic Three.js fields
- Browser-based cymatic visuals with templates, waveform scrubbing, and shaders

## Reddit Post

Hey all, I wanted to share a project I have been building called Wavefield:

https://github.com/niko-dellic/wavefield

It is a browser-based cymatic audio visualizer. You can load audio, scrub
through the waveform, and the app maps the frequency analysis into
Chladni-style modal patterns rendered with Three.js.

The thing I have been most interested in is making it feel less like a generic
audio-reactive visualizer and more like a small visual instrument. The controls
let you tune the modal density, node width, harmonic mix, color response,
screen/sphere projection, trails, fisheye, terminal-style contouring, and other
post-processing effects. I also added templates so you can quickly jump between
different looks.

Tech stack:

- TypeScript + Vite
- Three.js/WebGL shaders
- Web Audio analysis
- Wavesurfer for playback and waveform scrubbing
- Tweakpane-style controls

Some areas I would love feedback on:

- Does the visual language read as cymatic / standing-wave inspired, or just
  abstract audio-reactive graphics?
- What controls would make this more useful as a live visual tool?
- Any ideas for better audio feature mapping?
- Are there communities or workflows this would fit into besides the usual
  creative coding / Three.js circles?

I am still iterating on the feel of the field model, but it is already usable
locally with:

```sh
npm install
npm run dev
```

Would love any thoughts, criticism, or ideas.

## Three.js Forum Post

Title:
Wavefield: cymatic audio visualization in the browser with Three.js

Body:

Hi everyone, I wanted to share a Three.js project I have been working on:
Wavefield.

Repo: https://github.com/niko-dellic/wavefield

Wavefield is a browser-based cymatic audio visualizer. It analyzes audio in the
browser and maps frequency features into Chladni-style modal patterns, rendered
as an interactive GPU field with Three.js.

The main renderer supports both screen and sphere projections. The shader side
has controls for modal density, harmonic mix, node width, softness,
interference, warp, chromesthesia-like color response, and a handful of
post-processing effects such as bloom, fisheye, pixelation, contouring, and
trails.

The app also includes:

- local audio upload
- bundled sample tracks
- waveform playback and scrubbing
- saved visual templates
- live rendering controls

I am especially interested in feedback from the Three.js side:

- Any shader/rendering architecture suggestions?
- Better ways to handle screen vs sphere projection?
- Ideas for making this more performance-friendly while keeping the controls
  expressive?
- Any examples of audio-reactive Three.js work I should study?

Thanks for taking a look.

## AV / TouchDesigner-Adjacent Post

Title:
Wavefield: a browser-based cymatic visual instrument

Body:

I have been working on a small browser-based visual instrument called
Wavefield:

https://github.com/niko-dellic/wavefield

The idea is to turn music into cymatic, standing-wave-inspired visuals rather
than a more typical spectrum/ripple visualizer. It runs in the browser with
Three.js and Web Audio. You can load a track, scrub the waveform, tune the
field, and switch between saved visual templates.

It is not trying to replace tools like TouchDesigner, Max/Jitter, Resolume, or
Notch. It is more like a lightweight web-native sketchbook for exploring
audio-reactive fields and shader-driven looks.

I would be curious how people in realtime AV / live visuals would think about
using something like this:

- What controls would make it more playable?
- Would MIDI/OSC make this more interesting?
- Is browser-based enough for experiments, or would this need capture/output
  features to be useful?
- What audio features would you want exposed for mapping?

Happy to hear ideas from anyone working with realtime visuals, generative art,
or music-reactive systems.

## Short Comment Version

I built Wavefield, a browser-based cymatic audio visualizer using Three.js and
Web Audio. It maps audio analysis into Chladni-style modal fields, with
waveform scrubbing, templates, screen/sphere projections, and post-processing
controls.

Repo: https://github.com/niko-dellic/wavefield

I would love feedback on the audio mapping, shader/rendering approach, and what
would make it feel more like a usable visual instrument.

## Before Posting

- Attach the animated WebP or a short hosted MP4 first; visual-first posts will
  land better than text-only posts.
- Use the GitHub repo link after the visual, not before it.
- Mention that it runs locally if there is no hosted demo yet.
- For Reddit, check each community's self-promo rules before posting.
- For the Three.js forum, use the Showcase category and include implementation
  details, not just the announcement.
