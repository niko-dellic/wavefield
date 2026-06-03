import type {
  AudioFeatureFrame,
  CymaticSettings,
  SpectralPeak,
} from "../types.ts";
import {
  atlasModeForFrequency,
  nearestModesForFrequency,
} from "./modeAtlas.ts";
import {
  clamp01,
  frequencyFromCentroid,
  getBandForFrequency,
} from "./modalMath.ts";
import { BAND_SCALE_KEYS, type ModalAtlasEntry } from "./modalTypes.ts";

export type ModeTarget = {
  entry: ModalAtlasEntry;
  weight: number;
  excitation: number;
  pulse: number;
};

const MAX_PEAKS = 6;
const NEIGHBORS_PER_PEAK = 2;

type RawTarget = {
  entry: ModalAtlasEntry;
  weight: number;
  excitation: number;
  pulse: number;
};

/**
 * Project a feature frame onto a set of weighted Chladni modes. The strongest
 * spectral peaks each light up their nearest atlas figure(s); the resulting
 * weights are then sharpened by a focus contrast curve and scaled by the
 * frame's absolute level, so a clear dominant figure emerges and the whole
 * field fades with the music. Manual / live frames flow through this same path.
 */
export function projectFrameToTargets(
  frame: AudioFeatureFrame,
  settings: CymaticSettings,
): ModeTarget[] {
  const accum = new Map<string, RawTarget>();

  const peaks = frame.peaks.length
    ? frame.peaks
    : [synthesizePeakFromCentroid(frame)];

  peaks.slice(0, MAX_PEAKS).forEach((peak, rank) => {
    const rankFalloff = 1 / (1 + rank * 0.6);
    const bandScale = settings[BAND_SCALE_KEYS[peak.band]];
    const peakEnergy = peak.energy ?? peak.amplitude;
    const base =
      peak.amplitude *
      (0.4 + peakEnergy * 0.6) *
      (0.7 + peak.harmonicWeight * 0.3) *
      bandScale *
      rankFalloff;
    if (base <= 1e-5) {
      return;
    }

    const neighbors = nearestModesForFrequency(
      peak.frequency,
      NEIGHBORS_PER_PEAK,
    );
    neighbors.forEach((entry, neighborIndex) => {
      const share = neighborIndex === 0 ? 1 : 0.42;
      const onset = frame.onsets[entry.band] ?? 0;
      addRawTarget(accum, {
        entry,
        weight: base * share,
        excitation:
          (peakEnergy * 0.6 + frame.signals.energy * 0.3 + frame.rms * 0.2) *
          base *
          share,
        pulse:
          clamp01(
            frame.signals.pulse * 0.5 + onset * 0.5 + frame.signals.beat * 0.4,
          ) * share,
      });
    });
  });

  if (accum.size === 0) {
    const entry = atlasModeForFrequency(frequencyFromCentroid(frame.centroid));
    addRawTarget(accum, {
      entry,
      weight: frame.rms,
      excitation: frame.signals.energy,
      pulse: frame.signals.pulse,
    });
  }

  return emphasize(accum, frame, settings);
}

function addRawTarget(accum: Map<string, RawTarget>, target: RawTarget) {
  const existing = accum.get(target.entry.key);
  if (!existing) {
    accum.set(target.entry.key, { ...target });
    return;
  }

  existing.weight += target.weight;
  existing.excitation += target.excitation;
  existing.pulse = Math.max(existing.pulse, target.pulse);
}

function emphasize(
  accum: Map<string, RawTarget>,
  frame: AudioFeatureFrame,
  settings: CymaticSettings,
): ModeTarget[] {
  let maxWeight = 0;
  for (const target of accum.values()) {
    maxWeight = Math.max(maxWeight, target.weight);
  }
  if (maxWeight <= 1e-6) {
    return [];
  }

  // `patternHoldSeconds` is repurposed as the focus/contrast control: a higher
  // exponent suppresses weaker modes so the dominant figure stays crisp.
  const exponent = 1 + Math.max(0, settings.patternHoldSeconds) * 1.6;
  // Response expands quiet signal (response > 1 lifts small values) so subtle
  // moments still move the field; response = 1 is a linear, faithful mapping.
  const response = Math.max(0.1, settings.audioResponse);
  const rawLevel = frame.rms * 0.5 + frame.signals.energy * 0.5;
  // Absolute level so the field tracks loudness rather than always rendering a
  // fully-lit dominant mode.
  const level = clamp01(Math.pow(rawLevel, 1 / response) * settings.sensitivity);

  const targets: ModeTarget[] = [];
  for (const target of accum.values()) {
    const share = target.weight / maxWeight;
    const shaped = Math.pow(share, exponent);
    // Keep the dominant figure clearly lit at all times; loudness brightens it
    // further rather than being the gate that lets it appear at all.
    targets.push({
      entry: target.entry,
      weight: clamp01(shaped * (0.55 + 0.45 * level)),
      excitation: clamp01(
        Math.pow(clamp01(target.excitation / maxWeight), 1 / response) *
          settings.gain *
          settings.modalDrive,
      ),
      pulse: clamp01(target.pulse),
    });
  }

  return targets.sort((left, right) => right.weight - left.weight);
}

function synthesizePeakFromCentroid(frame: AudioFeatureFrame): SpectralPeak {
  const frequency = frequencyFromCentroid(frame.centroid);
  return {
    frequency,
    amplitude: frame.rms,
    energy: frame.signals.energy,
    bin: 0,
    band: getBandForFrequency(frequency),
    pitchClass: 0,
    harmonicWeight: frame.signals.harmonicity,
  };
}
