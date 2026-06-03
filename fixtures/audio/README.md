# Audio Fixtures

These files are local testing fixtures for Wavefield's decoder, analyzer, and renderer.

Try them with:

```sh
cargo run -- "fixtures/audio/music for inst mix ab oz.mp3"
cargo run -- "fixtures/audio/music for inst mix ab oz.wav" --no-audio
cargo run -- "fixtures/audio/contradictions inst mix ab oz.mp3" --no-audio --frames 120
```

The multitrack zip is intentionally not included because it is too large for regular GitHub repository history.
