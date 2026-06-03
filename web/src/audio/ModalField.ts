import {
  BAND_COLORS,
  type AudioAnalysis,
  type AudioFeatureFrame,
  type AudioFeatureSignals,
  type ChromaProfile,
  type CymaticSettings,
  type FrequencyBand,
  type SpectralPeak,
} from "../types";
import { mapFrequencyToChladniMode } from "./chladniModes";
import { ChladniPatternStabilizer } from "./chladniStability";
import { EMPTY_CHROMA_PROFILE, EMPTY_FEATURE_SIGNALS } from "./featureAnalysis";

export const MAX_CHLADNI_MODES = 12;
export const MAX_MODAL_MODES = MAX_CHLADNI_MODES;

export type ChladniMode = {
  mode: [number, number];
  frequency: number;
  amplitude: number;
  phase: number;
  coherence: number;
  frequencyNorm: number;
  band: FrequencyBand;
  color: [number, number, number];
  colorWeight: number;
  driver: number;
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
  };
};

type ModalAtlasEntry = {
  key: string;
  mode: [number, number];
  naturalFrequency: number;
  frequencyNorm: number;
  band: FrequencyBand;
};

type ModalState = ModalAtlasEntry & {
  amplitude: number;
  phase: number;
  coherence: number;
  lastDrive: number;
  driver: number;
  pulse: number;
  layer: number;
};

type ModeDriver = {
  strength: number;
  pulse: number;
  layer: number;
  frequency: number;
  harmonicWeight: number;
};

type PersistentDriver = {
  strength: number;
  targetStrength: number;
  pulse: number;
  layer: number;
  frequency: number;
  harmonicWeight: number;
  lastSeen: number;
};

const BANDS: FrequencyBand[] = ["low", "mid", "high"];
const BAND_SCALE_KEYS: Record<
  FrequencyBand,
  "lowScale" | "midScale" | "highScale"
> = {
  low: "lowScale",
  mid: "midScale",
  high: "highScale",
};

const MIN_FREQUENCY = 70;
const MAX_FREQUENCY = 7_200;
const ATLAS_SIZE = 72;
const HARMONIC_DRIVER_WEIGHTS = [1, 0.66, 0.46, 0.32, 0.22];
const MODAL_ATLAS = buildModalAtlas();
const DISPLAY_MODE_INDEXES = buildDisplayModeIndexes(MODAL_ATLAS.length, MAX_MODAL_MODES);

const EMPTY_BANDS: Record<FrequencyBand, number> = {
  low: 0,
  mid: 0,
  high: 0,
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
  },
};

export class ModalFieldEngine {
  private analysis: AudioAnalysis | null = null;
  private readonly modes: ModalState[];
  private lastTime = 0;
  private previousFrame: AudioFeatureFrame | null = null;
  private smoothedRms = 0;
  private smoothedCentroid = 0;
  private smoothedFlux = 0;
  private readonly smoothedBands: Record<FrequencyBand, number> = { ...EMPTY_BANDS };
  private readonly smoothedOnsets: Record<FrequencyBand, number> = { ...EMPTY_BANDS };
  private readonly persistentDrivers = new Map<string, PersistentDriver>();
  private readonly patternStabilizer = new ChladniPatternStabilizer();
  private displayModeKeys: string[] = [];

  constructor() {
    this.modes = MODAL_ATLAS.map((entry) => ({
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

  setAnalysis(analysis: AudioAnalysis | null) {
    this.analysis = analysis;
    this.reset(0);
  }

  reset(time: number) {
    this.lastTime = time;
    this.previousFrame = this.getFrameAt(time);
    for (const mode of this.modes) {
      mode.amplitude = 0;
      mode.coherence = 0;
      mode.lastDrive = 0;
      mode.driver = 0;
      mode.pulse = 0;
      mode.layer = 0;
    }
    this.smoothedRms = 0;
    this.smoothedCentroid = 0;
    this.smoothedFlux = 0;
    for (const band of BANDS) {
      this.smoothedBands[band] = 0;
      this.smoothedOnsets[band] = 0;
    }
    this.persistentDrivers.clear();
    this.displayModeKeys = [];
    this.patternStabilizer.reset();
  }

  update(
    time: number,
    settings: CymaticSettings,
    deltaSeconds: number,
  ): ModalFieldFrame {
    if (time + 0.05 < this.lastTime || Math.abs(time - this.lastTime) > 1.25) {
      this.reset(time);
    }

    const safeDelta = clamp(deltaSeconds, 0, 0.1);
    const frame = this.getFrameAt(time);
    if (!frame) {
      this.lastTime = time;
      return EMPTY_MODAL_FIELD_FRAME;
    }
    const previousFrame = this.previousFrame ?? frame;
    const flux = Math.max(
      0,
      frame.bands.low -
        previousFrame.bands.low +
        frame.bands.mid -
        previousFrame.bands.mid +
        frame.bands.high -
        previousFrame.bands.high,
    );
    this.smoothedRms = smoothAudioValue(this.smoothedRms, frame.rms, safeDelta, 18, 5);
    this.smoothedCentroid = smoothAudioValue(
      this.smoothedCentroid,
      frame.centroid,
      safeDelta,
      12,
      4,
    );
    this.smoothedFlux = smoothAudioValue(
      this.smoothedFlux,
      clamp01(flux * 1.5),
      safeDelta,
      24,
      6,
    );
    for (const band of BANDS) {
      this.smoothedBands[band] = smoothAudioValue(
        this.smoothedBands[band],
        frame.bands[band],
        safeDelta,
        20,
        5,
      );
      this.smoothedOnsets[band] = smoothAudioValue(
        this.smoothedOnsets[band],
        frame.onsets[band],
        safeDelta,
        34,
        8,
      );
    }
    const rawModeDrivers = resolveModeDrivers(frame, settings, time);
    const modeDrivers = this.resolvePersistentModeDrivers(
      rawModeDrivers,
      frame,
      settings,
      time,
      safeDelta,
    );

    for (const mode of this.modes) {
      const bandScale = settings[BAND_SCALE_KEYS[mode.band]];
      const bandEnergy = this.smoothedBands[mode.band];
      const onset = this.smoothedOnsets[mode.band];
      const driver = modeDrivers.get(mode.key);
      const driverStrength = driver?.strength ?? 0;
      const driverPulse = driver?.pulse ?? 0;
      const layer = driver?.layer ?? 0;
      const frequencyAffinity = driver
        ? getFrequencyAffinity(mode.naturalFrequency, driver.frequency)
        : getFrequencyAffinity(mode.naturalFrequency, frequencyFromCentroid(frame.centroid)) * 0.18;
      const localPulse = clamp01(
        driverPulse * 0.76 +
          frame.signals.pulse * (0.18 + hashMode(mode.mode) * 0.16) +
          onset * 0.28,
      );
      const drive = clamp01(
        (driverStrength * (1.08 + frame.signals.structure * 0.45) +
          bandEnergy * (0.18 + layer * 0.18) +
          localPulse * (0.36 + layer * 0.2) +
          this.smoothedRms * 0.1 +
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
        (0.28 +
          localPulse * 0.34 +
          frame.signals.energy * 0.18 +
          (driver?.harmonicWeight ?? 0) * 0.16);
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
      mode.driver = smoothAudioValue(mode.driver, driverStrength, safeDelta, 20, 4);
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

    this.previousFrame = frame;
    this.lastTime = time;

    return {
      modes: this.getDisplayModes(settings.modalCount)
        .map((mode) => ({
          mode: mode.mode,
          frequency: mode.naturalFrequency,
          amplitude: mode.amplitude,
          phase: mode.phase,
          coherence: mode.coherence,
          frequencyNorm: mode.frequencyNorm,
          band: mode.band,
          color: createModeColor(mode.naturalFrequency, mode.band, frame.chroma),
          colorWeight: clamp01(
            mode.amplitude * 0.46 +
              mode.coherence * 0.3 +
              mode.driver * 0.24,
          ),
          driver: mode.driver,
          pulse: mode.pulse,
          layer: mode.layer,
        })),
      rms: this.smoothedRms,
      centroid: this.smoothedCentroid,
      flux: this.smoothedFlux,
      bands: { ...this.smoothedBands },
      onsets: { ...this.smoothedOnsets },
      peaks: frame.peaks,
      chroma: frame.chroma,
      signals: frame.signals,
      debug: {
        activeModeCount: modeDrivers.size,
        backboneCount: Array.from(modeDrivers.values()).filter((driver) => driver.layer < 0.5).length,
        detailCount: Array.from(modeDrivers.values()).filter((driver) => driver.layer >= 0.5).length,
        peakSummary: formatPeakSummary(frame.peaks),
      },
    };
  }

  private resolvePersistentModeDrivers(
    rawDrivers: Map<string, ModeDriver>,
    frame: AudioFeatureFrame,
    settings: CymaticSettings,
    time: number,
    deltaSeconds: number,
  ) {
    const targets =
      settings.driveMode === "manual"
        ? rawDrivers
        : this.resolveAudioPatternTargets(rawDrivers, frame, settings, time);

    this.updatePersistentDrivers(targets, settings, time, deltaSeconds);

    const drivers = new Map<string, ModeDriver>();
    for (const [key, driver] of this.persistentDrivers) {
      if (driver.strength <= 0.0008 && driver.targetStrength <= 0.0008) {
        continue;
      }
      drivers.set(key, {
        strength: clamp01(driver.strength),
        pulse: clamp01(driver.pulse),
        layer: driver.layer,
        frequency: driver.frequency,
        harmonicWeight: driver.harmonicWeight,
      });
    }

    return drivers;
  }

  private resolveAudioPatternTargets(
    rawDrivers: Map<string, ModeDriver>,
    frame: AudioFeatureFrame,
    settings: CymaticSettings,
    time: number,
  ) {
    this.updateBasePattern(rawDrivers, frame, settings, time);

    const targets = new Map<string, ModeDriver>();
    this.addBasePatternDrivers(targets, frame, settings);

    for (const [key, driver] of rawDrivers) {
      addModeDriver(targets, getAtlasModeByKey(key), {
        strength: driver.strength * 0.32,
        pulse: driver.pulse,
        layer: 1,
        frequency: driver.frequency,
        harmonicWeight: driver.harmonicWeight,
      });
    }

    return targets;
  }

  private updateBasePattern(
    rawDrivers: Map<string, ModeDriver>,
    frame: AudioFeatureFrame,
    settings: CymaticSettings,
    time: number,
  ) {
    const dominant = getDominantPatternDriver(rawDrivers, frame);
    this.patternStabilizer.update({
      frequency: dominant?.frequency ?? frequencyFromCentroid(frame.centroid),
      confidence: dominant?.confidence ?? frame.rms * 0.22,
      time,
      holdSeconds: settings.patternHoldSeconds,
      rms: this.smoothedRms,
      energy: frame.signals.energy,
      change: frame.signals.change,
      beatConfidence: frame.signals.beatConfidence,
      harmonicity: frame.signals.harmonicity,
    });
  }

  private addBasePatternDrivers(
    targets: Map<string, ModeDriver>,
    frame: AudioFeatureFrame,
    settings: CymaticSettings,
  ) {
    const baseEnergy = clamp01(
      this.smoothedRms * 0.86 +
        frame.signals.energy * 0.38 +
        this.smoothedFlux * 0.18,
    );
    const basePulse = clamp01(
      frame.signals.pulse * 0.32 +
        this.smoothedFlux * 0.18 +
        (this.smoothedOnsets.low + this.smoothedOnsets.mid + this.smoothedOnsets.high) *
          0.08,
    );
    const baseStrength =
      (0.13 + baseEnergy * 0.82) *
      settings.gain *
      settings.sensitivity *
      settings.modalDrive;

    HARMONIC_DRIVER_WEIGHTS.slice(0, 4).forEach((weight, index) => {
      const harmonic = index + 1;
      const frequency = this.patternStabilizer.getFrequency() * harmonic;
      if (frequency > MAX_FREQUENCY * 1.1) {
        return;
      }
      const mode = getAtlasModeForFrequency(frequency);
      const bandScale = settings[BAND_SCALE_KEYS[mode.band]];
      addModeDriver(targets, mode, {
        strength: baseStrength * weight * bandScale * (index === 0 ? 1 : 0.62),
        pulse: basePulse * (index === 0 ? 0.7 : 0.45),
        layer: index === 0 ? 0 : 0.35,
        frequency,
        harmonicWeight: frame.signals.harmonicity,
      });

      if (index < 2) {
        for (const neighbor of getNearestAtlasModes(frequency, 3).slice(1, 3)) {
          addModeDriver(targets, neighbor, {
            strength: baseStrength * weight * 0.32 * bandScale,
            pulse: basePulse * 0.36,
            layer: 0.45,
            frequency,
            harmonicWeight: frame.signals.harmonicity * 0.8,
          });
        }
      }
    });
  }

  private updatePersistentDrivers(
    targets: Map<string, ModeDriver>,
    settings: CymaticSettings,
    time: number,
    deltaSeconds: number,
  ) {
    const morphSeconds = Math.max(0.05, settings.morphSeconds);
    const morphAlpha = 1 - Math.exp(-deltaSeconds / morphSeconds);
    const pulseDecay = Math.exp(-deltaSeconds / Math.max(0.08, morphSeconds * 0.42));

    for (const driver of this.persistentDrivers.values()) {
      driver.targetStrength = 0;
      driver.pulse *= pulseDecay;
    }

    for (const [key, target] of targets) {
      const existing = this.persistentDrivers.get(key);
      if (!existing) {
        this.persistentDrivers.set(key, {
          strength: 0,
          targetStrength: clamp01(target.strength),
          pulse: clamp01(target.pulse),
          layer: target.layer,
          frequency: target.frequency,
          harmonicWeight: target.harmonicWeight,
          lastSeen: time,
        });
        continue;
      }

      existing.targetStrength = clamp01(target.strength);
      existing.pulse = Math.max(existing.pulse, target.pulse);
      existing.layer = target.layer;
      existing.frequency = target.frequency;
      existing.harmonicWeight = target.harmonicWeight;
      existing.lastSeen = time;
    }

    for (const [key, driver] of this.persistentDrivers) {
      driver.strength += (driver.targetStrength - driver.strength) * morphAlpha;
      if (
        driver.strength < 0.0008 &&
        driver.targetStrength <= 0.0008 &&
        time - driver.lastSeen > morphSeconds * 2.5
      ) {
        this.persistentDrivers.delete(key);
      }
    }
  }

  private getDisplayModes(modalCount: number) {
    const count = Math.min(MAX_MODAL_MODES, Math.max(1, modalCount));
    const activeEntries = this.modes
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
        if (Math.abs(left.mode.naturalFrequency - right.mode.naturalFrequency) > 0.0001) {
          return left.mode.naturalFrequency - right.mode.naturalFrequency;
        }
        return right.score - left.score;
      });
    const activeByKey = new Map(
      activeEntries.map((entry) => [entry.mode.key, entry]),
    );
    const selected = this.displayModeKeys
      .map((key) => activeByKey.get(key))
      .filter((entry): entry is { mode: ModalState; index: number; score: number } =>
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
      const mode = this.modes[index];
      if (mode && !used.has(mode.key)) {
        selected.push(mode);
        used.add(mode.key);
      }
    }

    this.displayModeKeys = selected.map((mode) => mode.key);
    return selected;
  }

  private getFrameAt(time: number): AudioFeatureFrame | null {
    if (!this.analysis?.frames.length) {
      return null;
    }

    const frames = this.analysis.frames;
    let low = 0;
    let high = frames.length - 1;

    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (frames[middle].time <= time) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return frames[low] ?? null;
  }
}

export function createAmbientModalFieldFrame(time: number): ModalFieldFrame {
  const shimmer = 0.5 + 0.5 * Math.sin(time * 0.42);
  const bands: Record<FrequencyBand, number> = {
    low: 0.18 + shimmer * 0.03,
    mid: 0.24 + shimmer * 0.04,
    high: 0.12 + shimmer * 0.02,
  };
  const modes = MODAL_ATLAS.slice(4, 4 + MAX_MODAL_MODES).map((mode, index) => {
    const bandBias =
      mode.band === "low" ? bands.low : mode.band === "mid" ? bands.mid : bands.high;
    const wave = 0.5 + 0.5 * Math.sin(time * (0.08 + mode.frequencyNorm * 0.18) + index * 0.73);

    return {
      mode: mode.mode,
      frequency: mode.naturalFrequency,
      amplitude: clamp01((0.1 + bandBias * 0.38) * (0.72 + wave * 0.18)),
      phase: hashMode(mode.mode) * Math.PI * 2,
      coherence: 0.42 + mode.frequencyNorm * 0.28,
      frequencyNorm: mode.frequencyNorm,
      band: mode.band,
      color: createModeColor(mode.naturalFrequency, mode.band),
      colorWeight: 0.62,
      driver: 0.32 + wave * 0.16,
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
    },
    debug: {
      activeModeCount: modes.length,
      backboneCount: modes.filter((mode) => mode.layer < 0.5).length,
      detailCount: modes.filter((mode) => mode.layer >= 0.5).length,
      peakSummary: "ambient",
    },
  };
}

function buildModalAtlas(): ModalAtlasEntry[] {
  const candidates = new Map<string, ModalAtlasEntry>();
  const targetFrequencies = buildFrequencyCenters(
    MIN_FREQUENCY,
    MAX_FREQUENCY,
    ATLAS_SIZE,
  );
  const rawCandidates: ModalAtlasEntry[] = [];

  for (let m = 1; m <= 28; m += 1) {
    for (let n = 1; n <= 28; n += 1) {
      const magnitude = Math.hypot(m, n);
      const naturalFrequency = 220 * Math.pow(magnitude / Math.hypot(3, 5), 2);
      const key = `${m}:${n}`;
      rawCandidates.push({
        key,
        mode: [m, n],
        naturalFrequency,
        frequencyNorm: clampFrequencyNorm(naturalFrequency),
        band: getBandForFrequency(naturalFrequency),
      });
    }
  }

  for (const target of targetFrequencies) {
    const nearest = rawCandidates
      .filter((candidate) => !candidates.has(candidate.key))
      .sort(
        (left, right) =>
          Math.abs(Math.log2(left.naturalFrequency / target)) -
          Math.abs(Math.log2(right.naturalFrequency / target)),
      )[0];
    if (nearest) {
      candidates.set(nearest.key, nearest);
    }
  }

  return Array.from(candidates.values()).sort(
    (left, right) => left.naturalFrequency - right.naturalFrequency,
  );
}

function buildFrequencyCenters(min: number, max: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(1, count - 1);
    return min * Math.pow(max / min, t);
  });
}

function buildDisplayModeIndexes(sourceCount: number, displayCount: number) {
  if (sourceCount <= displayCount) {
    return Array.from({ length: sourceCount }, (_, index) => index);
  }

  const indexes: number[] = [];
  const used = new Set<number>();
  for (let index = 0; index < displayCount; index += 1) {
    const t = index / Math.max(1, displayCount - 1);
    const sourceIndex = Math.round(t * (sourceCount - 1));
    if (!used.has(sourceIndex)) {
      indexes.push(sourceIndex);
      used.add(sourceIndex);
    }
  }

  for (let index = 0; indexes.length < displayCount && index < sourceCount; index += 1) {
    if (!used.has(index)) {
      indexes.push(index);
      used.add(index);
    }
  }

  return indexes;
}

function resolveModeDrivers(
  frame: AudioFeatureFrame,
  settings: CymaticSettings,
  time: number,
) {
  const drivers = new Map<string, ModeDriver>();
  if (settings.driveMode === "manual") {
    const frequency = getManualFrequency(settings, time);
    const mode = getAtlasModeForFrequency(frequency);
    addModeDriver(drivers, mode, {
      strength: 1,
      pulse: 0.38,
      layer: 0,
      frequency,
      harmonicWeight: 1,
    });
    return drivers;
  }

  const peaks = frame.peaks.length
    ? frame.peaks
    : [
        {
          frequency: frequencyFromCentroid(frame.centroid),
          amplitude: frame.rms,
          harmonicWeight: frame.signals.harmonicity,
          band: getBandForFrequency(frequencyFromCentroid(frame.centroid)),
          bin: 0,
          pitchClass: 0,
        },
      ];

  peaks.slice(0, 6).forEach((peak, peakIndex) => {
    HARMONIC_DRIVER_WEIGHTS.forEach((harmonicWeight, harmonicIndex) => {
      const harmonicOrder = harmonicIndex + 1;
      const targetFrequency = peak.frequency * harmonicOrder;
      if (targetFrequency > MAX_FREQUENCY * 1.25) {
        return;
      }

      const familyCount = harmonicIndex === 0 && peakIndex < 3 ? 2 : 1;
      const layer = harmonicIndex === 0 && peakIndex < 3 ? 0 : 1;
      const primaryMode = getAtlasModeForFrequency(targetFrequency);
      const candidates = [primaryMode, ...getNearestAtlasModes(targetFrequency, familyCount + 2)]
        .filter(
          (mode, index, modes) =>
            modes.findIndex((candidate) => candidate.key === mode.key) === index,
        );

      candidates.slice(0, familyCount).forEach((mode, familyIndex) => {
        const affinity = getFrequencyAffinity(mode.naturalFrequency, targetFrequency);
        const familyWeight = familyIndex === 0 ? 1 : 0.72;
        const strength =
          peak.amplitude *
          harmonicWeight *
          familyWeight *
          affinity *
          (0.74 + peak.harmonicWeight * 0.36) *
          (peakIndex === 0 ? 1 : 0.88 / (peakIndex + 1));
        addModeDriver(drivers, mode, {
          strength,
          pulse: clamp01(
            frame.signals.pulse * (0.26 + harmonicIndex * 0.12) +
              frame.onsets[mode.band] * 0.48 +
              frame.signals.change * (layer ? 0.38 : 0.16),
          ),
          layer,
          frequency: targetFrequency,
          harmonicWeight: peak.harmonicWeight,
        });
      });
    });
  });

  if (!drivers.size) {
    const fallbackFrequency = frequencyFromCentroid(frame.centroid);
    for (const mode of getNearestAtlasModes(fallbackFrequency, 4)) {
      addModeDriver(drivers, mode, {
        strength: frame.rms * 0.32,
        pulse: frame.signals.pulse * 0.4,
        layer: 0,
        frequency: fallbackFrequency,
        harmonicWeight: frame.signals.harmonicity,
      });
    }
  }

  return drivers;
}

function addModeDriver(
  drivers: Map<string, ModeDriver>,
  mode: ModalAtlasEntry,
  driver: ModeDriver,
) {
  if (driver.strength <= 0.0001) {
    return;
  }

  const existing = drivers.get(mode.key);
  if (!existing) {
    drivers.set(mode.key, {
      ...driver,
      strength: clamp01(driver.strength),
      pulse: clamp01(driver.pulse),
    });
    return;
  }

  existing.strength = clamp01(existing.strength + driver.strength * 0.72);
  existing.pulse = Math.max(existing.pulse, driver.pulse);
  existing.harmonicWeight = Math.max(existing.harmonicWeight, driver.harmonicWeight);
  if (driver.layer < existing.layer || driver.strength > existing.strength * 0.9) {
    existing.layer = driver.layer;
    existing.frequency = driver.frequency;
  }
}

function getNearestAtlasModes(frequency: number, count: number) {
  return MODAL_ATLAS.slice()
    .sort((left, right) => {
      const leftDistance = Math.abs(Math.log2(left.naturalFrequency / frequency));
      const rightDistance = Math.abs(Math.log2(right.naturalFrequency / frequency));
      if (Math.abs(leftDistance - rightDistance) > 0.0001) {
        return leftDistance - rightDistance;
      }
      return left.mode[0] + left.mode[1] - (right.mode[0] + right.mode[1]);
    })
    .slice(0, count);
}

function getAtlasModeForFrequency(frequency: number) {
  const mapped = mapFrequencyToChladniMode(frequency);
  const direct = MODAL_ATLAS.find(
    (mode) => mode.mode[0] === mapped.m && mode.mode[1] === mapped.n,
  );
  if (direct) {
    return direct;
  }

  return {
    key: `${mapped.m}:${mapped.n}`,
    mode: [mapped.m, mapped.n] as [number, number],
    naturalFrequency: mapped.frequency,
    frequencyNorm: clampFrequencyNorm(mapped.frequency),
    band: getBandForFrequency(mapped.frequency),
  };
}

function getAtlasModeByKey(key: string) {
  const existing = MODAL_ATLAS.find((mode) => mode.key === key);
  if (existing) {
    return existing;
  }

  const [m = 3, n = 5] = key.split(":").map((part) => Number.parseInt(part, 10));
  const naturalFrequency =
    220 * Math.pow(Math.hypot(m, n) / Math.hypot(3, 5), 2);
  return {
    key,
    mode: [m, n] as [number, number],
    naturalFrequency,
    frequencyNorm: clampFrequencyNorm(naturalFrequency),
    band: getBandForFrequency(naturalFrequency),
  };
}

function getDominantPatternDriver(
  drivers: Map<string, ModeDriver>,
  frame: AudioFeatureFrame,
) {
  let best:
    | {
        frequency: number;
        confidence: number;
      }
    | null = null;

  for (const driver of drivers.values()) {
    if (driver.layer > 0.5) {
      continue;
    }
    const confidence =
      driver.strength *
      (0.72 + driver.harmonicWeight * 0.24 + frame.signals.structure * 0.2);
    if (!best || confidence > best.confidence) {
      best = {
        frequency: driver.frequency,
        confidence,
      };
    }
  }

  if (best) {
    return best;
  }

  const peak = frame.peaks[0];
  if (!peak) {
    return {
      frequency: frequencyFromCentroid(frame.centroid),
      confidence: frame.rms * 0.22 + frame.signals.structure * 0.08,
    };
  }

  return {
    frequency: peak.frequency,
    confidence:
      peak.amplitude *
      (0.54 + peak.harmonicWeight * 0.28 + frame.signals.structure * 0.18),
  };
}

function getBandForFrequency(frequency: number): FrequencyBand {
  if (frequency < 250) {
    return "low";
  }

  if (frequency < 2_000) {
    return "mid";
  }

  return "high";
}

function frequencyFromCentroid(centroid: number) {
  return MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, clamp01(centroid));
}

function getManualFrequency(settings: CymaticSettings, time: number) {
  const baseFrequency = clamp(settings.testFrequency, MIN_FREQUENCY, MAX_FREQUENCY);
  if (!settings.frequencySweep) {
    return baseFrequency;
  }

  const sweep = 0.5 + 0.5 * Math.sin(time * Math.PI * 2 * settings.frequencySweepRate);
  return MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, sweep);
}

function clampFrequencyNorm(frequency: number) {
  return clamp01(
    (Math.log2(frequency) - Math.log2(MIN_FREQUENCY)) /
      (Math.log2(MAX_FREQUENCY) - Math.log2(MIN_FREQUENCY)),
  );
}

function getFrequencyAffinity(frequency: number, target: number) {
  const distance = Math.abs(Math.log2(frequency / Math.max(1, target)));
  return Math.exp(-distance * 1.55);
}

function formatPeakSummary(peaks: SpectralPeak[]) {
  if (!peaks.length) {
    return "none";
  }

  return peaks
    .slice(0, 4)
    .map((peak) => `${Math.round(peak.frequency)}Hz`)
    .join(" ");
}

function createModeColor(
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

function hashMode(mode: [number, number]) {
  return (
    Math.abs(
      Math.sin(mode[0] * 12.9898 + mode[1] * 78.233) *
        43_758.5453,
    ) % 1
  );
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothAudioValue(
  current: number,
  target: number,
  deltaSeconds: number,
  attackHz: number,
  releaseHz: number,
) {
  const speed = target > current ? attackHz : releaseHz;
  return current + (target - current) * (1 - Math.exp(-deltaSeconds * speed));
}

function mod(value: number, base: number) {
  return ((value % base) + base) % base;
}
