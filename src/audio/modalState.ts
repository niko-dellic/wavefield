import type {
  AudioFeatureFrame,
  CymaticSettings,
  FrequencyBand,
} from "../types.ts";
import { DISPLAY_MODE_INDEXES, MODAL_ATLAS } from "./modalAtlas.ts";
import {
  clamp01,
  createModeColor,
  frequencyFromCentroid,
  getFrequencyAffinity,
  hashMode,
  smoothAudioValue,
} from "./modalMath.ts";
import {
  BAND_SCALE_KEYS,
  MAX_MODAL_MODES,
  type ModalState,
  type ModeDriver,
  type ModalSlot,
} from "./modalTypes.ts";

export function createModalStates(): ModalState[] {
  return MODAL_ATLAS.map((entry) => ({
    ...entry,
    amplitude: 0,
    phase: hashMode(entry.mode) * Math.PI * 2,
    coherence: 0,
    lastDrive: 0,
    driver: 0,
    pulse: 0,
    layer: 0,
  }));
}

export function resetModalStates(modes: ModalState[]) {
  for (const mode of modes) {
    mode.amplitude = 0;
    mode.coherence = 0;
    mode.lastDrive = 0;
    mode.driver = 0;
    mode.pulse = 0;
    mode.layer = 0;
  }
}

export function updateModalStates({
  modes,
  modeDrivers,
  frame,
  settings,
  smoothedBands,
  smoothedOnsets,
  smoothedRms,
  safeDelta,
}: {
  modes: ModalState[];
  modeDrivers: Map<string, ModeDriver>;
  frame: AudioFeatureFrame;
  settings: CymaticSettings;
  smoothedBands: Record<FrequencyBand, number>;
  smoothedOnsets: Record<FrequencyBand, number>;
  smoothedRms: number;
  safeDelta: number;
}) {
  for (const mode of modes) {
    const bandScale = settings[BAND_SCALE_KEYS[mode.band]];
    const bandEnergy = smoothedBands[mode.band];
    const onset = smoothedOnsets[mode.band];
    const driver = modeDrivers.get(mode.key);
    const driverStrength = driver?.strength ?? 0;
    const driverPulse = driver?.pulse ?? 0;
    const layer = driver?.layer ?? 1;
    const frequencyAffinity = driver
      ? getFrequencyAffinity(mode.naturalFrequency, driver.frequency)
      : getFrequencyAffinity(
          mode.naturalFrequency,
          frequencyFromCentroid(frame.centroid),
        ) * 0.18;
    const localPulse = clamp01(
      driverPulse * 0.76 +
        frame.signals.pulse * (0.18 + hashMode(mode.mode) * 0.16) +
        onset * 0.28,
    );
    const drive = clamp01(
      (driverStrength * (1.36 + frame.signals.structure * 0.52) +
        bandEnergy * (0.18 + layer * 0.18) +
        localPulse * (0.55 + layer * 0.26) +
        smoothedRms * 0.18 +
        frequencyAffinity * (0.04 + bandEnergy * 0.18)) *
        settings.gain *
        settings.sensitivity *
        settings.modalDrive *
        bandScale,
    );
    const decaySeconds =
      settings.modalDecay *
      (layer < 0.5 ? 1.52 : 0.72) *
      (mode.band === "low" ? 1.2 : mode.band === "mid" ? 1 : 0.78);
    const decay = Math.exp(-safeDelta / Math.max(0.08, decaySeconds));
    const injection =
      drive *
      (0.38 +
        localPulse * 0.52 +
        frame.signals.energy * 0.28 +
        (driver?.harmonicWeight ?? 0) * 0.18);
    const nextAmplitude =
      mode.amplitude * decay + injection * (1 - mode.amplitude * 0.42);
    const coherenceTarget = clamp01(
      driverStrength * 0.5 +
        frequencyAffinity * 0.26 +
        frame.signals.structure * 0.22 +
        bandEnergy * 0.12 +
        (1 - layer) * 0.14,
    );

    mode.amplitude = clamp01(nextAmplitude);
    mode.driver = smoothAudioValue(
      mode.driver,
      driverStrength,
      safeDelta,
      20,
      4,
    );
    mode.pulse = smoothAudioValue(mode.pulse, localPulse, safeDelta, 30, 7);
    mode.layer = layer;
    mode.coherence +=
      (coherenceTarget - mode.coherence) *
      (1 - Math.exp(-safeDelta * (drive > mode.lastDrive ? 9 : 3.6)));
    mode.phase +=
      safeDelta *
      (0.045 +
        mode.frequencyNorm * 0.3 +
        mode.driver * 0.28 +
        localPulse * (0.44 + hashMode(mode.mode) * 0.28) +
        layer * 0.18);
    mode.lastDrive = drive;
  }
}

export function selectDisplayModes({
  modes,
  displayModeKeys,
  modalCount,
}: {
  modes: ModalState[];
  displayModeKeys: string[];
  modalCount: number;
}) {
  const count = Math.min(MAX_MODAL_MODES, Math.max(1, modalCount));
  const activeEntries = modes
    .map((mode, index) => ({
      mode,
      index,
      score:
        mode.driver * 1.25 +
        mode.amplitude * 0.86 +
        mode.coherence * 0.34 +
        mode.pulse * 0.22,
    }))
    .filter((entry) => entry.score > 0.003)
    .sort((left, right) => {
      const layerDelta = left.mode.layer - right.mode.layer;
      if (Math.abs(layerDelta) > 0.001) {
        return layerDelta;
      }
      if (
        Math.abs(left.mode.naturalFrequency - right.mode.naturalFrequency) >
        0.0001
      ) {
        return left.mode.naturalFrequency - right.mode.naturalFrequency;
      }
      return right.score - left.score;
    });
  const activeByKey = new Map(
    activeEntries.map((entry) => [entry.mode.key, entry]),
  );
  const selected = displayModeKeys
    .map((key) => activeByKey.get(key))
    .filter(
      (entry): entry is { mode: ModalState; index: number; score: number } =>
        Boolean(entry),
    )
    .slice(0, count)
    .map((entry) => entry.mode);
  const used = new Set(selected.map((mode) => mode.key));

  for (const entry of activeEntries) {
    if (selected.length >= count) {
      break;
    }
    if (!used.has(entry.mode.key)) {
      selected.push(entry.mode);
      used.add(entry.mode.key);
    }
  }

  for (const index of DISPLAY_MODE_INDEXES) {
    if (selected.length >= count) {
      break;
    }
    const mode = modes[index];
    if (mode && !used.has(mode.key)) {
      selected.push(mode);
      used.add(mode.key);
    }
  }

  return selected;
}

export function createModalSlots(
  modes: ModalState[],
  frame: AudioFeatureFrame,
): ModalSlot[] {
  return modes.map((mode) => ({
    mode: mode.mode,
    frequency: mode.naturalFrequency,
    amplitude: mode.amplitude,
    phase: mode.phase,
    coherence: mode.coherence,
    frequencyNorm: mode.frequencyNorm,
    band: mode.band,
    color: createModeColor(mode.naturalFrequency, mode.band, frame.chroma),
    colorWeight: clamp01(
      mode.amplitude * 0.46 + mode.coherence * 0.3 + mode.driver * 0.24,
    ),
    driver: mode.driver,
    pulse: mode.pulse,
    layer: mode.layer,
  }));
}
