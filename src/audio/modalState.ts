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
    topology: 0,
    phase: hashMode(entry.mode) * Math.PI * 2,
    coherence: 0,
    lastDrive: 0,
    driver: 0,
    excitation: 0,
    pulse: 0,
    layer: 0,
  }));
}

export function resetModalStates(modes: ModalState[]) {
  for (const mode of modes) {
    mode.amplitude = 0;
    mode.topology = 0;
    mode.coherence = 0;
    mode.lastDrive = 0;
    mode.driver = 0;
    mode.excitation = 0;
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
  let topologyTotal = 0;
  for (const driver of modeDrivers.values()) {
    topologyTotal += Math.max(0, driver.topology);
  }
  const topologyNormalizer = Math.max(0.0001, topologyTotal);

  for (const mode of modes) {
    const bandScale = settings[BAND_SCALE_KEYS[mode.band]];
    const bandEnergy = smoothedBands[mode.band];
    const onset = smoothedOnsets[mode.band];
    const driver = modeDrivers.get(mode.key);
    const driverStrength = driver?.strength ?? 0;
    const driverTopology = driver?.topology ?? 0;
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
    const topologyTarget = clamp01(
      ((driverTopology / topologyNormalizer) * (2.1 + settings.sensitivity * 0.26) +
        driverStrength * 0.08 +
        frequencyAffinity * (driver ? 0.04 : 0.015)) *
        (layer < 0.5 ? 1 : 0.72),
    );
    const excitationTarget = clamp01(
      (driverStrength * (0.48 + frame.signals.structure * 0.18) +
        bandEnergy * (0.16 + layer * 0.1) +
        localPulse * (0.72 + layer * 0.22) +
        smoothedRms * 0.12 +
        frame.signals.excitation * 0.2) *
        settings.gain *
        settings.modalDrive *
        bandScale,
    );
    const drive = clamp01(topologyTarget * 0.52 + excitationTarget * 0.48);
    const decaySeconds =
      settings.modalDecay *
      (layer < 0.5 ? 1.52 : 0.72) *
      (mode.band === "low" ? 1.2 : mode.band === "mid" ? 1 : 0.78);
    const topologyAlpha = 1 - Math.exp(-safeDelta / Math.max(0.05, settings.morphSeconds));
    const excitationAlpha = 1 - Math.exp(-safeDelta * (excitationTarget > mode.excitation ? 15 : 4.5));
    const amplitudeDecay = Math.exp(-safeDelta / Math.max(0.08, decaySeconds));
    const coherenceTarget = clamp01(
      topologyTarget * 0.42 +
        driverStrength * 0.2 +
        frequencyAffinity * 0.26 +
        frame.signals.structure * 0.22 +
        bandEnergy * 0.12 +
        (1 - layer) * 0.14,
    );
    const visualTarget = clamp01(
      topologyTarget * (0.58 + frame.signals.topology * 0.24) +
        excitationTarget * 0.26 +
        localPulse * 0.12,
    );

    mode.topology += (topologyTarget - mode.topology) * topologyAlpha;
    mode.excitation += (excitationTarget - mode.excitation) * excitationAlpha;
    mode.amplitude = clamp01(
      mode.amplitude * amplitudeDecay + visualTarget * (1 - amplitudeDecay),
    );
    mode.driver = smoothAudioValue(
      mode.driver,
      topologyTarget,
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
        mode.topology * 1.65 +
        mode.driver * 0.9 +
        mode.excitation * 0.42 +
        mode.amplitude * 0.3 +
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
    sphericalMode: mode.sphericalMode,
    frequency: mode.naturalFrequency,
    amplitude: mode.amplitude,
    topology: mode.topology,
    phase: mode.phase,
    coherence: mode.coherence,
    frequencyNorm: mode.frequencyNorm,
    band: mode.band,
    color: createModeColor(mode.naturalFrequency, mode.band, frame.chroma),
    colorWeight: clamp01(
      mode.topology * 0.42 +
        mode.excitation * 0.28 +
        mode.coherence * 0.18 +
        mode.driver * 0.12,
    ),
    driver: mode.driver,
    excitation: mode.excitation,
    pulse: mode.pulse,
    layer: mode.layer,
  }));
}
