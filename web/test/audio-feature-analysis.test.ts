import assert from "node:assert/strict";
import test from "node:test";

import {
  addTemporalFeatures,
  buildChromaProfile,
  extractSpectrumFrame,
  findSpectralPeaks,
  type RawAudioFeatureFrame,
} from "../src/audio/featureAnalysis.ts";
import { mapFrequencyToChladniMode } from "../src/audio/chladniModes.ts";

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 1024;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;

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
