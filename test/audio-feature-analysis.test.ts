import assert from "node:assert/strict";
import test from "node:test";

import {
  AudioTemporalFeatureTracker,
  addTemporalFeatures,
  buildChromaProfile,
  extractSpectrumFrame,
  findSpectralPeaks,
  type RawAudioFeatureFrame,
} from "../src/audio/featureAnalysis.ts";
import { FFT_SIZE as ANALYSIS_FFT_SIZE } from "../src/audio/analyze.ts";
import { createManualFeatureFrame } from "../src/audio/fieldSources.ts";
import {
  atlasModeForFrequency,
  nearestModesForFrequency,
} from "../src/audio/modeAtlas.ts";
import { ModeBank } from "../src/audio/modeBank.ts";
import { projectFrameToTargets } from "../src/audio/modeProjection.ts";
import {
  deriveSphericalModeFromChladniMode,
  evaluateSphericalPermutationMode,
  getSphericalPermutationCount,
} from "../src/audio/sphericalModes.ts";
import { ModalFieldEngine } from "../src/audio/ModalField.ts";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import type { AudioFeatureFrame, CymaticSettings } from "../src/types.ts";

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 2048;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;

// Audio-drive defaults with the cosmetic JS motion layers (fractional figure
// morphing + palette-wander ranking bias) disabled. These engine tests assert
// the discrete modal-projection contract (exact topology keys), which is
// orthogonal to that time-evolving overlay.
const AUDIO_TEST_SETTINGS: CymaticSettings = {
  ...DEFAULT_SETTINGS,
  driveMode: "audio",
  cymaticModeMorph: false,
  cymaticPaletteWander: false,
};

test("browser analysis uses a balanced 2048 point FFT", () => {
  assert.equal(ANALYSIS_FFT_SIZE, 2048);
  assert.equal(FFT_SIZE, ANALYSIS_FFT_SIZE);
});

test("findSpectralPeaks selects separated dominant tones", () => {
  const fundamental = 5 * BIN_HZ;
  const magnitudes = createSpectrum([
    [fundamental, 1],
    [fundamental * 2, 0.62],
    [fundamental * 3, 0.4],
  ]);

  const peaks = findSpectralPeaks({
    magnitudes,
    sampleRate: SAMPLE_RATE,
    fftSize: FFT_SIZE,
    count: 4,
  });

  assert.ok(Math.abs(peaks[0].frequency - fundamental) < BIN_HZ * 0.1);
  assert.ok(peaks.some((peak) => Math.abs(peak.frequency - fundamental * 2) < BIN_HZ * 0.1));
  assert.equal(peaks[0].band, "low");
  assert.ok(peaks[0].harmonicWeight > 0.3);
});

test("spectral peaks preserve absolute energy apart from relative prominence", () => {
  const quiet = findSpectralPeaks({
    magnitudes: createSpectrum([[220, 0.001]]),
    sampleRate: SAMPLE_RATE,
    fftSize: FFT_SIZE,
    count: 1,
  });
  const loud = findSpectralPeaks({
    magnitudes: createSpectrum([[220, 0.005]]),
    sampleRate: SAMPLE_RATE,
    fftSize: FFT_SIZE,
    count: 1,
  });

  assert.ok(quiet[0].amplitude > 0.95);
  assert.ok(loud[0].amplitude > 0.95);
  assert.ok(loud[0].energy > quiet[0].energy);
});

test("chroma profile locks onto the pitch class of a steady tone", () => {
  const magnitudes = createSpectrum([[10 * BIN_HZ, 1]]);
  const chroma = buildChromaProfile(magnitudes, SAMPLE_RATE, FFT_SIZE);

  assert.equal(chroma.tonic, 10);
  assert.ok(chroma.confidence > 0.7);
});

test("harmonic stacks produce stronger structure than broadband texture", () => {
  const fundamental = 5 * BIN_HZ;
  const harmonic = extractSpectrumFrame({
    index: 0,
    time: 0,
    rms: 0.24,
    magnitudes: createSpectrum([
      [fundamental, 1],
      [fundamental * 2, 0.68],
      [fundamental * 3, 0.42],
    ]),
    sampleRate: SAMPLE_RATE,
    fftSize: FFT_SIZE,
  });
  const broadband = extractSpectrumFrame({
    index: 0,
    time: 0,
    rms: 0.24,
    magnitudes: createBroadbandSpectrum(),
    sampleRate: SAMPLE_RATE,
    fftSize: FFT_SIZE,
  });
  const [harmonicFrame] = addTemporalFeatures([harmonic]);
  const [broadbandFrame] = addTemporalFeatures([broadband]);

  assert.ok(harmonicFrame.signals.structure > broadbandFrame.signals.structure);
  assert.ok(broadbandFrame.signals.texture > harmonicFrame.signals.texture);
});

test("transient band rises produce change and pulse without erasing structure", () => {
  const frames: RawAudioFeatureFrame[] = [
    extractSpectrumFrame({
      index: 0,
      time: 0,
      rms: 0.1,
      magnitudes: createSpectrum([[220, 0.3]]),
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
    }),
    extractSpectrumFrame({
      index: 1,
      time: 1 / 60,
      rms: 0.34,
      magnitudes: createSpectrum([
        [220, 1],
        [440, 0.7],
        [880, 0.34],
      ]),
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
    }),
  ];
  const [, transient] = addTemporalFeatures(frames);

  assert.ok(transient.signals.change > 0.15);
  assert.ok(transient.signals.pulse > 0.15);
  assert.ok(transient.signals.structure > 0.2);
});

test("temporal feature tracker matches batch temporal analysis", () => {
  const frames: RawAudioFeatureFrame[] = [
    extractSpectrumFrame({
      index: 0,
      time: 0,
      rms: 0.1,
      magnitudes: createSpectrum([[220, 0.3]]),
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
    }),
    extractSpectrumFrame({
      index: 1,
      time: 1 / 60,
      rms: 0.34,
      magnitudes: createSpectrum([
        [220, 1],
        [440, 0.7],
        [880, 0.34],
      ]),
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
    }),
  ];
  const tracker = new AudioTemporalFeatureTracker();
  const tracked = frames.map((frame) => tracker.update(frame));

  assert.deepEqual(tracked, addTemporalFeatures(frames));
  assert.ok(tracked[1].signals.change > 0.15);
  assert.ok(tracked[1].signals.pulse > 0.15);
});

test("mode atlas anchors 220Hz to the low-order 2:3 figure", () => {
  const mode = atlasModeForFrequency(220);

  assert.equal(mode.key, "2:3");
});

test("mode atlas maps neighbouring frequencies to distinct figures", () => {
  const low = atlasModeForFrequency(220);
  const near = atlasModeForFrequency(330);

  assert.notEqual(low.key, near.key);
});

test("mode atlas increases figure complexity with frequency", () => {
  const low = atlasModeForFrequency(110);
  const high = atlasModeForFrequency(880);

  assert.ok(modeEnergy(high.mode) > modeEnergy(low.mode));
  assert.ok(high.naturalFrequency > low.naturalFrequency);
});

test("mode atlas only contains non-degenerate (m < n) figures", () => {
  const sample = nearestModesForFrequency(440, 12);
  assert.ok(sample.every((entry) => entry.mode[0] < entry.mode[1]));
});

test("projection lights up the dominant figure for a single tone", () => {
  const targets = projectFrameToTargets(
    createSyntheticAudioFrame(0, 220),
    audioSettings(),
  );

  assert.ok(targets.length > 0);
  assert.equal(targets[0].entry.key, "2:3");
  assert.ok(targets[0].weight > 0.4);
});

test("projection keeps a clear dominant rather than a flat mode soup", () => {
  const targets = projectFrameToTargets(
    createSyntheticAudioFrame(0, 220),
    audioSettings(),
  );

  // The dominant figure should clearly outweigh any secondary modes.
  if (targets.length > 1) {
    assert.ok(targets[0].weight > targets[1].weight * 1.5);
  }
});

test("manual feature frames synthesize one isolated Chladni source", () => {
  const settings = createManualSettings({ testFrequency: 220 });
  const frame = createManualFeatureFrame(settings, 0);

  assert.equal(frame.peaks.length, 1);
  assert.equal(frame.peaks[0].frequency, 220);
  assert.equal(frame.peaks[0].band, "low");
  assert.equal(frame.chroma.confidence, 1);
  assert.equal(frame.signals.beat, 0);
  assert.equal(frame.signals.beatConfidence, 0);
});

test("manual modal engine updates without audio analysis", () => {
  const engine = new ModalFieldEngine();
  const frame = engine.update(
    0,
    createManualSettings({ testFrequency: 220 }),
    1 / 60,
  );

  assert.ok(frame.modes.length > 0);
  assert.equal(frame.peaks[0].frequency, 220);
});

test("manual modal engine frequency reset produces a different mode set", () => {
  const engine = new ModalFieldEngine();
  const low = engine.update(
    0,
    createManualSettings({ testFrequency: 220 }),
    1 / 60,
  );
  engine.reset(0);
  const high = engine.update(
    0,
    createManualSettings({ testFrequency: 880 }),
    1 / 60,
  );

  assert.notDeepEqual(
    low.modes.map((mode) => mode.mode),
    high.modes.map((mode) => mode.mode),
  );
});

test("manual modal engine frequency changes morph without clearing current topology", () => {
  const engine = new ModalFieldEngine();
  const lowSettings = createManualSettings({
    testFrequency: 220,
    morphSeconds: 0.25,
  });
  const highSettings = createManualSettings({
    testFrequency: 880,
    morphSeconds: 0.25,
  });

  let field = engine.update(0, lowSettings, 1 / 60);
  const lowMode = field.debug.topologyMode;
  const highModeKey = atlasModeForFrequency(880).key;

  for (let frame = 1; frame <= 12; frame += 1) {
    field = engine.update(frame / 60, highSettings, 1 / 60);
  }

  assert.equal(field.debug.topologyMode, highModeKey);
  assert.ok(
    field.modes.some(
      (mode) => `${mode.mode[0]}:${mode.mode[1]}` === lowMode && mode.topology > 0,
    ),
    "previous manual topology should still be fading out",
  );
  assert.ok(
    field.modes.some(
      (mode) => `${mode.mode[0]}:${mode.mode[1]}` === highModeKey && mode.topology > 0,
    ),
    "new manual topology should be fading in",
  );
});

test("audio modal engine stays empty without analysis", () => {
  const engine = new ModalFieldEngine();
  const frame = engine.update(
    0,
    { ...DEFAULT_SETTINGS, driveMode: "audio" },
    1 / 60,
  );

  assert.equal(frame.modes.length, 0);
});

test("audio modal engine morphs topology after a sustained frequency change", () => {
  const engine = new ModalFieldEngine();
  const frames = [
    ...Array.from({ length: 60 }, (_, index) => createSyntheticAudioFrame(index, 220)),
    ...Array.from({ length: 90 }, (_, index) => createSyntheticAudioFrame(index + 60, 880)),
  ];
  engine.setAnalysis({ duration: frames.length / 60, sampleRate: SAMPLE_RATE, frames });
  let field = engine.update(0, AUDIO_TEST_SETTINGS, 1 / 60);
  for (const frame of frames) {
    field = engine.update(frame.time, AUDIO_TEST_SETTINGS, 1 / 60);
  }

  assert.equal(field.debug.topologyMode, atlasModeForFrequency(880).key);
  assert.ok(field.modes.some((mode) => mode.frequency > 600));
});

test("audio modal engine treats brief transients as excitation without topology reset", () => {
  const engine = new ModalFieldEngine();
  const frames = [
    ...Array.from({ length: 60 }, (_, index) => createSyntheticAudioFrame(index, 220)),
    createSyntheticAudioFrame(60, 880, { pulse: 0.9, energy: 1 }),
    ...Array.from({ length: 14 }, (_, index) => createSyntheticAudioFrame(index + 61, 220)),
  ];
  engine.setAnalysis({ duration: frames.length / 60, sampleRate: SAMPLE_RATE, frames });
  let field = engine.update(0, AUDIO_TEST_SETTINGS, 1 / 60);
  for (const frame of frames) {
    field = engine.update(frame.time, AUDIO_TEST_SETTINGS, 1 / 60);
  }

  assert.equal(field.debug.topologyMode, "2:3");
  assert.ok(field.debug.excitation > 0.2);
});

test("audio modal engine keeps a crisp dominant at high response settings", () => {
  const engine = new ModalFieldEngine();
  const frames = Array.from({ length: 120 }, (_, index) =>
    createSyntheticAudioFrame(index, 220, { pulse: 0.2, energy: 1 }),
  );
  const settings = {
    ...DEFAULT_SETTINGS,
    driveMode: "audio" as const,
    gain: 4,
    sensitivity: 5,
    modalDrive: 4,
  };
  engine.setAnalysis({ duration: frames.length / 60, sampleRate: SAMPLE_RATE, frames });
  let field = engine.update(0, settings, 1 / 60);
  for (const frame of frames) {
    field = engine.update(frame.time, settings, 1 / 60);
  }

  // The dominant figure should be strong, but the whole bank must not pin to 1.
  assert.ok(field.modes[0].topology > 0.45);
  assert.ok(field.modes.filter((mode) => mode.topology > 0.99).length <= 1);
  if (field.modes.length > 1) {
    assert.ok(field.modes[1].topology < field.modes[0].topology);
  }
});

test("figure morph tracks audio motion — busy passages melt faster than calm ones", () => {
  const modeA = atlasModeForFrequency(120);
  const modeB = atlasModeForFrequency(2_400);
  // Sanity: the two figures must be genuinely different for the morph to travel.
  assert.notDeepEqual(modeA.mode, modeB.mode);

  const settings: CymaticSettings = {
    ...DEFAULT_SETTINGS,
    cymaticModeMorph: true,
    cymaticPaletteWander: false, // isolate the morph from ranking drift
  };
  const dt = 1 / 60;
  const target = (entry: typeof modeA) => [
    { entry, weight: 1, excitation: 0.8, pulse: 0 },
  ];

  // Distance of rank-0's emitted (fractional) figure from a target mode.
  const distanceToB = (bank: ModeBank, frame: AudioFeatureFrame) => {
    const slot = bank.selectSlots(frame, settings).find((s) => s);
    if (!slot) {
      return Infinity;
    }
    return Math.hypot(slot.mode[0] - modeB.mode[0], slot.mode[1] - modeB.mode[1]);
  };

  const settle = (bank: ModeBank, frame: AudioFeatureFrame) => {
    for (let i = 0; i < 180; i += 1) {
      bank.update(target(modeA), settings, dt);
      bank.selectSlots(frame, settings);
    }
  };

  const calmFrame = createSyntheticAudioFrame(0, 120, { pulse: 0.02, energy: 0.15 });
  const busyFrame = createSyntheticAudioFrame(0, 120, { pulse: 0.95, energy: 1 });

  const calmBank = new ModeBank();
  const busyBank = new ModeBank();
  settle(calmBank, calmFrame);
  settle(busyBank, busyFrame);

  // Now switch the target to a very different figure and let each bank morph for
  // the same short window under its own audio-motion level.
  let calmDistance = Infinity;
  let busyDistance = Infinity;
  for (let i = 0; i < 48; i += 1) {
    calmBank.update(target(modeB), settings, dt);
    busyBank.update(target(modeB), settings, dt);
    calmDistance = distanceToB(calmBank, calmFrame);
    busyDistance = distanceToB(busyBank, busyFrame);
  }

  // Busy audio should have melted substantially closer to the new figure than
  // the calm pass over the same window.
  assert.ok(
    busyDistance < calmDistance,
    `busy morph (${busyDistance.toFixed(3)}) should outpace calm morph (${calmDistance.toFixed(3)})`,
  );
  assert.ok(busyDistance < calmDistance * 0.75);
});

test("spherical mode derivation keeps the 220Hz anchor on a low-order triplet", () => {
  const anchor = atlasModeForFrequency(220);
  const mode = deriveSphericalModeFromChladniMode(anchor.mode);

  assert.equal(mode.length, 3);
  assert.ok(mode[0] <= mode[1] && mode[1] <= mode[2]);
  assert.ok(mode[2] <= 6);
});

test("spherical mode derivation increases complexity with frequency", () => {
  const low = atlasModeForFrequency(110);
  const high = atlasModeForFrequency(880);
  const lowMode = deriveSphericalModeFromChladniMode(low.mode);
  const highMode = deriveSphericalModeFromChladniMode(high.mode);

  assert.ok(
    highMode[0] + highMode[1] + highMode[2] >
      lowMode[0] + lowMode[1] + lowMode[2],
  );
});

test("spherical permutation families report unique evaluation costs", () => {
  assert.equal(getSphericalPermutationCount([4, 4, 4]), 1);
  assert.equal(getSphericalPermutationCount([3, 4, 4]), 3);
  assert.equal(getSphericalPermutationCount([3, 4, 5]), 6);
});

test("spherical permutation evaluator normalizes repeated families", () => {
  const position: [number, number, number] = [0, 0, 0];
  assert.equal(
    evaluateSphericalPermutationMode({
      mode: [4, 4, 4],
      position,
      boundaryMode: "neumann",
    }),
    1,
  );
  assert.equal(
    Math.round(
      evaluateSphericalPermutationMode({
        mode: [3, 4, 5],
        position,
        boundaryMode: "neumann",
      }) * 1_000_000,
    ) / 1_000_000,
    Math.round(Math.sqrt(6) * 1_000_000) / 1_000_000,
  );
});

test("manual feature frames change source when test frequency changes", () => {
  const lowFrame = createManualFeatureFrame(
    createManualSettings({ testFrequency: 220 }),
    0,
  );
  const highFrame = createManualFeatureFrame(
    createManualSettings({ testFrequency: 880 }),
    0,
  );

  assert.notEqual(lowFrame.peaks[0].frequency, highFrame.peaks[0].frequency);
  assert.notEqual(
    atlasModeForFrequency(lowFrame.peaks[0].frequency).key,
    atlasModeForFrequency(highFrame.peaks[0].frequency).key,
  );
});

function modeEnergy(mode: [number, number]) {
  return mode[0] * mode[0] + mode[1] * mode[1];
}

function audioSettings(overrides: Partial<CymaticSettings> = {}): CymaticSettings {
  return { ...DEFAULT_SETTINGS, driveMode: "audio", ...overrides };
}

function createSpectrum(peaks: Array<[number, number]>) {
  const magnitudes = new Float32Array(FFT_SIZE / 2);
  for (const [frequency, amplitude] of peaks) {
    const bin = Math.round(frequency / BIN_HZ);
    if (bin > 0 && bin < magnitudes.length) {
      magnitudes[bin] = amplitude;
      magnitudes[bin - 1] = Math.max(magnitudes[bin - 1] ?? 0, amplitude * 0.18);
      magnitudes[bin + 1] = Math.max(magnitudes[bin + 1] ?? 0, amplitude * 0.18);
    }
  }
  return magnitudes;
}

function createBroadbandSpectrum() {
  const magnitudes = new Float32Array(FFT_SIZE / 2);
  for (let bin = 2; bin < magnitudes.length; bin += 1) {
    const wave = Math.sin(bin * 12.9898) * 43_758.5453;
    magnitudes[bin] = 0.08 + (wave - Math.floor(wave)) * 0.24;
  }
  return magnitudes;
}

function createSyntheticAudioFrame(
  index: number,
  frequency: number,
  options: { pulse?: number; energy?: number } = {},
): AudioFeatureFrame {
  const pulse = options.pulse ?? 0.05;
  const energy = options.energy ?? 0.7;
  const band = frequency < 250 ? "low" : frequency < 2_000 ? "mid" : "high";

  return {
    index,
    time: index / 60,
    rms: 0.5,
    centroid: Math.min(1, Math.log2(frequency / 70) / Math.log2(7_200 / 70)),
    bands: {
      low: band === "low" ? 0.8 : 0.04,
      mid: band === "mid" ? 0.8 : 0.04,
      high: band === "high" ? 0.8 : 0.04,
    },
    onsets: {
      low: band === "low" ? pulse : 0,
      mid: band === "mid" ? pulse : 0,
      high: band === "high" ? pulse : 0,
    },
    peaks: [
      {
        frequency,
        amplitude: 1,
        energy,
        bin: 0,
        band,
        pitchClass: 0,
        harmonicWeight: 1,
      },
    ],
    chroma: {
      bins: Array.from({ length: 12 }, () => 0),
      tonic: 0,
      confidence: 1,
      color: [1, 1, 1] as [number, number, number],
    },
    signals: {
      structure: 0.9,
      energy,
      change: pulse,
      pulse,
      excitation: Math.min(1, energy * 0.48 + pulse * 0.38 + energy * 0.34),
      topology: 1,
      beat: 0,
      beatConfidence: pulse,
      harmonicity: 1,
      texture: 0,
    },
    spectralFlux: pulse,
  };
}

function createManualSettings(
  overrides: Partial<CymaticSettings> = {},
): CymaticSettings {
  return {
    ...DEFAULT_SETTINGS,
    driveMode: "manual",
    frequencySweep: false,
    // The cosmetic JS motion layers (fractional figure morphing + palette-wander
    // ranking bias) deliberately make emitted mode numbers fractional / reorder
    // ranking over time. These engine tests assert the discrete modal-projection
    // contract, which is orthogonal to that overlay, so disable them here.
    cymaticModeMorph: false,
    cymaticPaletteWander: false,
    ...overrides,
  };
}
