import type {
  AudioFeatureFrame,
  CymaticSettings,
  FrequencyBand,
} from "../types.ts";
import {
  EMPTY_CHROMA_PROFILE,
  EMPTY_FEATURE_SIGNALS,
} from "./featureAnalysis.ts";
import { MODE_ATLAS } from "./modeAtlas.ts";
import {
  clamp,
  clamp01,
  clampFrequencyNorm,
  createChromaProfileForFrequency,
  createModeColor,
  getBandForFrequency,
  hashMode,
} from "./modalMath.ts";
import {
  MAX_FREQUENCY,
  MAX_MODAL_MODES,
  MIN_FREQUENCY,
  type ModalFieldFrame,
} from "./modalTypes.ts";

export function createAmbientModalFieldFrame(time: number): ModalFieldFrame {
  const shimmer = 0.5 + 0.5 * Math.sin(time * 0.42);
  const bands: Record<FrequencyBand, number> = {
    low: 0.18 + shimmer * 0.03,
    mid: 0.24 + shimmer * 0.04,
    high: 0.12 + shimmer * 0.02,
  };
  const modes = MODE_ATLAS.slice(4, 4 + MAX_MODAL_MODES).map((mode, index) => {
    const bandBias =
      mode.band === "low"
        ? bands.low
        : mode.band === "mid"
          ? bands.mid
          : bands.high;
    const wave =
      0.5 +
      0.5 * Math.sin(time * (0.08 + mode.frequencyNorm * 0.18) + index * 0.73);

    return {
      mode: mode.mode,
      sphericalMode: mode.sphericalMode,
      frequency: mode.naturalFrequency,
      amplitude: clamp01((0.1 + bandBias * 0.38) * (0.72 + wave * 0.18)),
      topology: 0.16 + wave * 0.08,
      phase: hashMode(mode.mode) * Math.PI * 2,
      coherence: 0.42 + mode.frequencyNorm * 0.28,
      frequencyNorm: mode.frequencyNorm,
      band: mode.band,
      color: createModeColor(mode.naturalFrequency, mode.band),
      colorWeight: 0.62,
      driver: 0.32 + wave * 0.16,
      excitation: 0.18 + wave * 0.08,
      pulse: 0.08 + wave * 0.08,
      layer: index % 3 === 0 ? 1 : 0,
    };
  });

  return {
    modes,
    rms: 0.18 + shimmer * 0.04,
    centroid: 0.34 + shimmer * 0.05,
    flux: 0.02,
    bands,
    onsets: {
      low: 0.02 + shimmer * 0.01,
      mid: 0.02 + shimmer * 0.01,
      high: 0.02 + shimmer * 0.01,
    },
    peaks: [],
    chroma: EMPTY_CHROMA_PROFILE,
    signals: {
      ...EMPTY_FEATURE_SIGNALS,
      structure: 0.45,
      energy: 0.22 + shimmer * 0.04,
      pulse: 0.04,
      excitation: 0.2 + shimmer * 0.04,
      topology: 0.32,
    },
    debug: {
      activeModeCount: modes.length,
      backboneCount: modes.filter((mode) => mode.layer < 0.5).length,
      detailCount: modes.filter((mode) => mode.layer >= 0.5).length,
      peakSummary: "ambient",
      topologyFrequency: 220,
      topologyMode: "3:5",
      excitation: 0.2 + shimmer * 0.04,
    },
  };
}

export function createManualFeatureFrame(
  settings: CymaticSettings,
  time: number,
): AudioFeatureFrame {
  const frequency = getManualFrequency(settings, time);
  const band = getBandForFrequency(frequency);
  const chroma = createChromaProfileForFrequency(frequency);
  const bands: Record<FrequencyBand, number> = {
    low: band === "low" ? 0.86 : 0.035,
    mid: band === "mid" ? 0.86 : 0.035,
    high: band === "high" ? 0.86 : 0.035,
  };
  const pulse = settings.frequencySweep ? 0.16 : 0.08;

  return {
    index: Math.round(time * 60),
    time,
    rms: 0.42,
    centroid: clampFrequencyNorm(frequency),
    bands,
    onsets: {
      low: band === "low" ? pulse : 0,
      mid: band === "mid" ? pulse : 0,
      high: band === "high" ? pulse : 0,
    },
    peaks: [
      {
        frequency,
        amplitude: 1,
        energy: 1,
        bin: 0,
        band,
        pitchClass: chroma.tonic,
        harmonicWeight: 1,
      },
    ],
    chroma,
    signals: {
      structure: 0.92,
      energy: 0.64,
      change: settings.frequencySweep ? 0.18 : 0.02,
      pulse,
      excitation: 0.72,
      topology: 1,
      beat: 0,
      beatConfidence: 0,
      harmonicity: 1,
      texture: 0.04,
    },
    spectralFlux: 0,
  };
}

export function getManualFrequency(settings: CymaticSettings, time: number) {
  const baseFrequency = clamp(
    settings.testFrequency,
    MIN_FREQUENCY,
    MAX_FREQUENCY,
  );
  if (!settings.frequencySweep) {
    return baseFrequency;
  }

  const sweep =
    0.5 + 0.5 * Math.sin(time * Math.PI * 2 * settings.frequencySweepRate);
  return MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, sweep);
}
