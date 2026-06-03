import { BAND_COLORS, type ChromaProfile, type FrequencyBand, type SpectralPeak } from "../types.ts";
import { MAX_FREQUENCY, MIN_FREQUENCY } from "./modalTypes.ts";

export function getBandForFrequency(frequency: number): FrequencyBand {
  if (frequency < 250) {
    return "low";
  }

  if (frequency < 2_000) {
    return "mid";
  }

  return "high";
}

export function frequencyFromCentroid(centroid: number) {
  return MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, clamp01(centroid));
}

export function clampFrequencyNorm(frequency: number) {
  return clamp01(
    (Math.log2(frequency) - Math.log2(MIN_FREQUENCY)) /
      (Math.log2(MAX_FREQUENCY) - Math.log2(MIN_FREQUENCY)),
  );
}

export function getFrequencyAffinity(frequency: number, target: number) {
  const distance = Math.abs(Math.log2(frequency / Math.max(1, target)));
  return Math.exp(-distance * 1.55);
}

export function formatPeakSummary(peaks: SpectralPeak[]) {
  if (!peaks.length) {
    return "none";
  }

  return peaks
    .slice(0, 4)
    .map((peak) => `${Math.round(peak.frequency)}Hz`)
    .join(" ");
}

export function createModeColor(
  frequency: number,
  band: FrequencyBand,
  chroma?: ChromaProfile,
): [number, number, number] {
  const pitchClass = mod(Math.round(69 + 12 * Math.log2(frequency / 440)), 12);
  const octave = clamp((Math.log2(frequency / 55) - 1) / 7, 0, 1);
  const hue = pitchClass / 12;
  const saturation = 0.48 + octave * 0.18;
  const value = 0.68 + octave * 0.26;
  const baseColor = hsvToRgb(hue, saturation, value);
  const bandColor = BAND_COLORS[band];

  return [
    baseColor[0] * 0.72 + bandColor[0] * 0.2 + (chroma?.color[0] ?? baseColor[0]) * 0.08,
    baseColor[1] * 0.72 + bandColor[1] * 0.2 + (chroma?.color[1] ?? baseColor[1]) * 0.08,
    baseColor[2] * 0.72 + bandColor[2] * 0.2 + (chroma?.color[2] ?? baseColor[2]) * 0.08,
  ];
}

export function createChromaProfileForFrequency(frequency: number): ChromaProfile {
  const pitchClass = mod(Math.round(69 + 12 * Math.log2(frequency / 440)), 12);
  const bins = Array.from({ length: 12 }, (_, index) =>
    index === pitchClass ? 1 : 0,
  );
  return {
    bins,
    tonic: pitchClass,
    confidence: 1,
    color: createModeColor(frequency, getBandForFrequency(frequency)),
  };
}

export function hashMode(mode: [number, number]) {
  return (
    Math.abs(
      Math.sin(mode[0] * 12.9898 + mode[1] * 78.233) *
        43_758.5453,
    ) % 1
  );
}

export function smoothAudioValue(
  current: number,
  target: number,
  deltaSeconds: number,
  attackHz: number,
  releaseHz: number,
) {
  const speed = target > current ? attackHz : releaseHz;
  return current + (target - current) * (1 - Math.exp(-deltaSeconds * speed));
}

export function clamp01(value: number) {
  return clamp(value, 0, 1);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function mod(value: number, base: number) {
  return ((value % base) + base) % base;
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const h = mod(hue, 1) * 6;
  const sector = Math.floor(h);
  const fraction = h - sector;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);

  switch (sector % 6) {
    case 0:
      return [value, t, p];
    case 1:
      return [q, value, p];
    case 2:
      return [p, value, t];
    case 3:
      return [p, q, value];
    case 4:
      return [t, p, value];
    default:
      return [value, p, q];
  }
}
