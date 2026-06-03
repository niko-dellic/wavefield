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
import { mapFrequencyToChladniMode } from "../src/audio/chladniModes.ts";
import {
  deriveSphericalModeFromChladniMode,
  evaluateSphericalPermutationMode,
  getSphericalPermutationCount,
} from "../src/audio/sphericalModes.ts";
import { ChladniPatternStabilizer } from "../src/audio/chladniStability.ts";
import { ModalFieldEngine } from "../src/audio/ModalField.ts";
import { DEFAULT_SETTINGS } from "../src/config/settings.ts";
import type { CymaticSettings } from "../src/types.ts";

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 2048;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;

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

test("chladni frequency mapping anchors 220Hz to the base 3:5 mode", () => {
  const mode = mapFrequencyToChladniMode(220);

  assert.equal(mode.m, 3);
  assert.equal(mode.n, 5);
});

test("chladni frequency mapping increases mode complexity with frequency", () => {
  const low = mapFrequencyToChladniMode(110);
  const high = mapFrequencyToChladniMode(880);

  assert.ok(high.m > low.m);
  assert.ok(high.n > low.n);
});

test("chladni frequency mapping clamps extreme frequencies", () => {
  const low = mapFrequencyToChladniMode(1);
  const high = mapFrequencyToChladniMode(48_000);

  assert.ok(low.m >= 1);
  assert.ok(low.n >= 1);
  assert.ok(high.m <= 28);
  assert.ok(high.n <= 28);
});

test("spherical mode derivation keeps 220Hz on a stable low-order triplet", () => {
  const chladni = mapFrequencyToChladniMode(220);
  const mode = deriveSphericalModeFromChladniMode([chladni.m, chladni.n]);

  assert.deepEqual(mode, [3, 4, 5]);
});

test("spherical mode derivation increases complexity with frequency", () => {
  const low = mapFrequencyToChladniMode(110);
  const high = mapFrequencyToChladniMode(880);
  const lowMode = deriveSphericalModeFromChladniMode([low.m, low.n]);
  const highMode = deriveSphericalModeFromChladniMode([high.m, high.n]);

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
  assert.notDeepEqual(
    mapFrequencyToChladniMode(lowFrame.peaks[0].frequency),
    mapFrequencyToChladniMode(highFrame.peaks[0].frequency),
  );
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
  let field = engine.update(0, { ...DEFAULT_SETTINGS, driveMode: "audio" }, 1 / 60);
  for (const frame of frames) {
    field = engine.update(frame.time, { ...DEFAULT_SETTINGS, driveMode: "audio" }, 1 / 60);
  }

  assert.equal(field.debug.topologyMode, "6:10");
  assert.ok(field.modes.some((mode) => mode.mode[0] === 6 && mode.mode[1] === 10));
});

test("audio modal engine treats brief transients as excitation without topology reset", () => {
  const engine = new ModalFieldEngine();
  const frames = [
    ...Array.from({ length: 60 }, (_, index) => createSyntheticAudioFrame(index, 220)),
    createSyntheticAudioFrame(60, 880, { pulse: 0.9, energy: 1 }),
    ...Array.from({ length: 14 }, (_, index) => createSyntheticAudioFrame(index + 61, 220)),
  ];
  engine.setAnalysis({ duration: frames.length / 60, sampleRate: SAMPLE_RATE, frames });
  let field = engine.update(0, { ...DEFAULT_SETTINGS, driveMode: "audio" }, 1 / 60);
  for (const frame of frames) {
    field = engine.update(frame.time, { ...DEFAULT_SETTINGS, driveMode: "audio" }, 1 / 60);
  }

  assert.equal(field.debug.topologyMode, "3:5");
  assert.ok(field.debug.excitation > 0.2);
});

test("audio modal engine avoids all-mode saturation at high response settings", () => {
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

  assert.equal(field.modes.filter((mode) => mode.amplitude > 0.99).length, 0);
  assert.ok(field.modes.some((mode) => mode.topology > 0.45));
});

test("chladni pattern stabilizer keeps its base through a brief transient", () => {
  const stabilizer = new ChladniPatternStabilizer();

  assert.equal(
    Math.round(
      stabilizer.update(createPatternInput({ time: 0, frequency: 220, confidence: 0.5 })),
    ),
    220,
  );
  assert.equal(
    Math.round(
      stabilizer.update(createPatternInput({ time: 0.2, frequency: 880, confidence: 1 })),
    ),
    220,
  );
  assert.equal(
    Math.round(
      stabilizer.update(createPatternInput({ time: 0.35, frequency: 220, confidence: 0.5 })),
    ),
    220,
  );
});

test("chladni pattern stabilizer adopts a sustained new dominant frequency", () => {
  const stabilizer = new ChladniPatternStabilizer();

  stabilizer.update(createPatternInput({ time: 0, frequency: 220, confidence: 0.5 }));
  stabilizer.update(createPatternInput({ time: 0.2, frequency: 880, confidence: 1 }));
  stabilizer.update(createPatternInput({ time: 0.45, frequency: 880, confidence: 1 }));
  const frequency = stabilizer.update(
    createPatternInput({ time: 0.62, frequency: 880, confidence: 1 }),
  );

  assert.equal(Math.round(frequency), 880);
});

test("chladni pattern stabilizer follows close pitch drift without a reset", () => {
  const stabilizer = new ChladniPatternStabilizer();

  stabilizer.update(createPatternInput({ time: 0, frequency: 220, confidence: 0.5 }));
  const drifted = stabilizer.update(
    createPatternInput({ time: 0.2, frequency: 231, confidence: 0.5 }),
  );

  assert.ok(drifted > 220);
  assert.ok(drifted < 231);
});

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

function createPatternInput({
  time,
  frequency,
  confidence,
}: {
  time: number;
  frequency: number;
  confidence: number;
}) {
  return {
    key: `${mapFrequencyToChladniMode(frequency).m}:${mapFrequencyToChladniMode(frequency).n}`,
    time,
    frequency,
    confidence,
    holdSeconds: 0.35,
    rms: 0.28,
    energy: 0.42,
    change: 0.18,
    beatConfidence: 0.28,
    harmonicity: 0.82,
  };
}

function createSyntheticAudioFrame(
  index: number,
  frequency: number,
  options: { pulse?: number; energy?: number } = {},
) {
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
    ...overrides,
  };
}
