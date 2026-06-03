import type {
  AudioAnalysis,
  AudioFeatureFrame,
  CymaticSettings,
  FrequencyBand,
} from "../types.ts";
import { ChladniPatternStabilizer } from "./chladniStability.ts";
import {
  createAmbientModalFieldFrame,
  createManualFeatureFrame,
} from "./fieldSources.ts";
import {
  addModeDriver,
  getDominantPatternDriver,
  materializePersistentDrivers,
  resolveModeDrivers,
  updatePersistentDrivers,
} from "./modalDrivers.ts";
import {
  getAtlasModeByKey,
  getAtlasModeForFrequency,
  getNearestAtlasModes,
} from "./modalAtlas.ts";
import {
  clamp,
  clamp01,
  formatPeakSummary,
  frequencyFromCentroid,
  smoothAudioValue,
} from "./modalMath.ts";
import {
  createModalSlots,
  createModalStates,
  resetModalStates,
  selectDisplayModes,
  updateModalStates,
} from "./modalState.ts";
import {
  BAND_SCALE_KEYS,
  BANDS,
  EMPTY_BANDS,
  EMPTY_MODAL_FIELD_FRAME,
  HARMONIC_DRIVER_WEIGHTS,
  MAX_CHLADNI_MODES,
  MAX_FREQUENCY,
  MAX_MODAL_MODES,
  type ModalFieldFrame,
  type ModalState,
  type ModeDriver,
  type PersistentDriver,
} from "./modalTypes.ts";

export {
  EMPTY_MODAL_FIELD_FRAME,
  MAX_CHLADNI_MODES,
  MAX_MODAL_MODES,
  createAmbientModalFieldFrame,
  createManualFeatureFrame,
};

export type { ChladniMode, ModalFieldFrame, ModalSlot } from "./modalTypes.ts";

export class ModalFieldEngine {
  private analysis: AudioAnalysis | null = null;
  private readonly modes: ModalState[];
  private lastTime = 0;
  private previousFrame: AudioFeatureFrame | null = null;
  private smoothedRms = 0;
  private smoothedCentroid = 0;
  private smoothedFlux = 0;
  private readonly smoothedBands: Record<FrequencyBand, number> = {
    ...EMPTY_BANDS,
  };
  private readonly smoothedOnsets: Record<FrequencyBand, number> = {
    ...EMPTY_BANDS,
  };
  private readonly persistentDrivers = new Map<string, PersistentDriver>();
  private readonly patternStabilizer = new ChladniPatternStabilizer();
  private displayModeKeys: string[] = [];

  constructor() {
    this.modes = createModalStates();
  }

  setAnalysis(analysis: AudioAnalysis | null) {
    this.analysis = analysis;
    this.reset(0);
  }

  reset(time: number) {
    this.lastTime = time;
    this.previousFrame = this.getFrameAt(time);
    resetModalStates(this.modes);
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

    const frame =
      settings.driveMode === "manual"
        ? createManualFeatureFrame(settings, time)
        : this.getFrameAt(time);
    if (!frame) {
      this.lastTime = time;
      return EMPTY_MODAL_FIELD_FRAME;
    }

    return this.updateWithFrame(frame, settings, time, deltaSeconds);
  }

  updateFromFeatureFrame(
    frame: AudioFeatureFrame,
    settings: CymaticSettings,
    deltaSeconds: number,
  ): ModalFieldFrame {
    if (
      frame.time + 0.05 < this.lastTime ||
      Math.abs(frame.time - this.lastTime) > 1.25
    ) {
      this.reset(frame.time);
    }

    return this.updateWithFrame(frame, settings, frame.time, deltaSeconds);
  }

  private updateWithFrame(
    frame: AudioFeatureFrame,
    settings: CymaticSettings,
    time: number,
    deltaSeconds: number,
  ): ModalFieldFrame {
    const safeDelta = clamp(deltaSeconds, 0, 0.1);
    const previousFrame =
      settings.driveMode === "manual" ? frame : (this.previousFrame ?? frame);
    const flux = Math.max(
      0,
      frame.bands.low -
        previousFrame.bands.low +
        frame.bands.mid -
        previousFrame.bands.mid +
        frame.bands.high -
        previousFrame.bands.high,
    );

    this.smoothedRms = smoothAudioValue(
      this.smoothedRms,
      frame.rms,
      safeDelta,
      18,
      5,
    );
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

    updateModalStates({
      modes: this.modes,
      modeDrivers,
      frame,
      settings,
      smoothedBands: this.smoothedBands,
      smoothedOnsets: this.smoothedOnsets,
      smoothedRms: this.smoothedRms,
      safeDelta,
    });

    this.previousFrame = frame;
    this.lastTime = time;

    const displayModes = selectDisplayModes({
      modes: this.modes,
      displayModeKeys: this.displayModeKeys,
      modalCount: settings.modalCount,
    });
    this.displayModeKeys = displayModes.map((mode) => mode.key);

    const topologyFrequency =
      settings.driveMode === "manual"
        ? (frame.peaks[0]?.frequency ?? frequencyFromCentroid(frame.centroid))
        : this.patternStabilizer.getFrequency();
    const topologyMode = getAtlasModeForFrequency(topologyFrequency).key;
    const excitation = clamp01(
      this.smoothedRms * 0.18 +
        frame.signals.excitation * 0.52 +
        this.smoothedFlux * 0.3,
    );

    return {
      modes: createModalSlots(displayModes, frame),
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
        backboneCount: Array.from(modeDrivers.values()).filter(
          (driver) => driver.layer < 0.5,
        ).length,
        detailCount: Array.from(modeDrivers.values()).filter(
          (driver) => driver.layer >= 0.5,
        ).length,
        peakSummary: formatPeakSummary(frame.peaks),
        topologyFrequency,
        topologyMode,
        excitation,
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
    if (settings.driveMode === "manual") {
      updatePersistentDrivers({
        persistentDrivers: this.persistentDrivers,
        targets: rawDrivers,
        settings,
        time,
        deltaSeconds,
      });

      return materializePersistentDrivers(this.persistentDrivers);
    }

    const targets = this.resolveAudioPatternTargets(
      rawDrivers,
      frame,
      settings,
      time,
    );

    updatePersistentDrivers({
      persistentDrivers: this.persistentDrivers,
      targets,
      settings,
      time,
      deltaSeconds,
    });

    return materializePersistentDrivers(this.persistentDrivers);
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
        strength: driver.strength * 0.58,
        topology: driver.topology * 0.86,
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
    const dominantFrequency =
      dominant?.frequency ?? frequencyFromCentroid(frame.centroid);
    this.patternStabilizer.update({
      key: getAtlasModeForFrequency(dominantFrequency).key,
      frequency: dominantFrequency,
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
        (this.smoothedOnsets.low +
          this.smoothedOnsets.mid +
          this.smoothedOnsets.high) *
          0.08,
    );
    const baseStrength =
      (0.16 + baseEnergy * 1.05) *
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
        topology:
          baseStrength *
          weight *
          bandScale *
          frame.signals.topology *
          (index === 0 ? 1.08 : 0.68),
        pulse: basePulse * (index === 0 ? 0.7 : 0.45),
        layer: index === 0 ? 0 : 0.35,
        frequency,
        harmonicWeight: frame.signals.harmonicity,
      });

      if (index < 2) {
        for (const neighbor of getNearestAtlasModes(frequency, 3).slice(1, 3)) {
          addModeDriver(targets, neighbor, {
            strength: baseStrength * weight * 0.32 * bandScale,
            topology: baseStrength * weight * 0.22 * bandScale * frame.signals.topology,
            pulse: basePulse * 0.36,
            layer: 0.45,
            frequency,
            harmonicWeight: frame.signals.harmonicity * 0.8,
          });
        }
      }
    });
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
