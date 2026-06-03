import type {
  AudioFeatureSignals,
  ChromaProfile,
  FrequencyBand,
  SpectralPeak,
} from "../types.ts";
import {
  EMPTY_CHROMA_PROFILE,
  EMPTY_FEATURE_SIGNALS,
} from "./featureAnalysis.ts";
import type { SphericalMode } from "./sphericalModes.ts";

export const MAX_CHLADNI_MODES = 12;
export const MAX_MODAL_MODES = MAX_CHLADNI_MODES;
export const MIN_FREQUENCY = 70;
export const MAX_FREQUENCY = 7_200;
export const ATLAS_SIZE = 72;
export const HARMONIC_DRIVER_WEIGHTS = [1, 0.66, 0.46, 0.32, 0.22];

export const BANDS: FrequencyBand[] = ["low", "mid", "high"];

export const BAND_SCALE_KEYS: Record<
  FrequencyBand,
  "lowScale" | "midScale" | "highScale"
> = {
  low: "lowScale",
  mid: "midScale",
  high: "highScale",
};

export const EMPTY_BANDS: Record<FrequencyBand, number> = {
  low: 0,
  mid: 0,
  high: 0,
};

export type ChladniMode = {
  mode: [number, number];
  sphericalMode: SphericalMode;
  frequency: number;
  amplitude: number;
  topology: number;
  phase: number;
  coherence: number;
  frequencyNorm: number;
  band: FrequencyBand;
  color: [number, number, number];
  colorWeight: number;
  driver: number;
  excitation: number;
  pulse: number;
  layer: number;
};

export type ModalSlot = ChladniMode;

export type ModalFieldFrame = {
  modes: ModalSlot[];
  rms: number;
  centroid: number;
  flux: number;
  bands: Record<FrequencyBand, number>;
  onsets: Record<FrequencyBand, number>;
  peaks: SpectralPeak[];
  chroma: ChromaProfile;
  signals: AudioFeatureSignals;
  debug: {
    activeModeCount: number;
    backboneCount: number;
    detailCount: number;
    peakSummary: string;
    topologyFrequency: number;
    topologyMode: string;
    excitation: number;
  };
};

export type ModalAtlasEntry = {
  key: string;
  mode: [number, number];
  sphericalMode: SphericalMode;
  naturalFrequency: number;
  frequencyNorm: number;
  band: FrequencyBand;
};

export type ModalState = ModalAtlasEntry & {
  amplitude: number;
  topology: number;
  phase: number;
  coherence: number;
  lastDrive: number;
  driver: number;
  excitation: number;
  pulse: number;
  layer: number;
};

export type ModeDriver = {
  strength: number;
  topology: number;
  pulse: number;
  layer: number;
  frequency: number;
  harmonicWeight: number;
};

export type PersistentDriver = {
  strength: number;
  targetStrength: number;
  topology: number;
  targetTopology: number;
  pulse: number;
  layer: number;
  frequency: number;
  harmonicWeight: number;
  lastSeen: number;
};

export const EMPTY_MODAL_FIELD_FRAME: ModalFieldFrame = {
  modes: [],
  rms: 0,
  centroid: 0,
  flux: 0,
  bands: EMPTY_BANDS,
  onsets: EMPTY_BANDS,
  peaks: [],
  chroma: EMPTY_CHROMA_PROFILE,
  signals: EMPTY_FEATURE_SIGNALS,
  debug: {
    activeModeCount: 0,
    backboneCount: 0,
    detailCount: 0,
    peakSummary: "none",
    topologyFrequency: 0,
    topologyMode: "none",
    excitation: 0,
  },
};
