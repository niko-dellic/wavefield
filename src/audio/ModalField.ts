import type {
  AudioAnalysis,
  AudioFeatureFrame,
  CymaticSettings,
  FrequencyBand,
} from "../types.ts";
import {
  createAmbientModalFieldFrame,
  createManualFeatureFrame,
} from "./fieldSources.ts";
import { ModeBank } from "./modeBank.ts";
import { projectFrameToTargets } from "./modeProjection.ts";
import { clamp, formatPeakSummary, smoothAudioValue } from "./modalMath.ts";
import {
  BANDS,
  EMPTY_BANDS,
  EMPTY_MODAL_FIELD_FRAME,
  MAX_CHLADNI_MODES,
  MAX_MODAL_MODES,
  type ModalFieldFrame,
  type ModalSlot,
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
  private readonly bank = new ModeBank();
  private lastTime = 0;
  private smoothedRms = 0;
  private smoothedCentroid = 0;
  private smoothedFlux = 0;
  private previousBandTotal = 0;
  private readonly smoothedBands: Record<FrequencyBand, number> = {
    ...EMPTY_BANDS,
  };
  private readonly smoothedOnsets: Record<FrequencyBand, number> = {
    ...EMPTY_BANDS,
  };

  setAnalysis(analysis: AudioAnalysis | null) {
    this.analysis = analysis;
    this.reset(0);
  }

  /**
   * Temporarily scale the palette-wander LFO speed. 1 = normal (a slow,
   * track-length drift); the "preview palette wander" UI button raises this so
   * the effect becomes visible within a few seconds, then restores it to 1.
   */
  setPaletteWanderRateScale(scale: number) {
    this.bank.paletteWanderRateScale = scale;
  }

  reset(time: number) {
    this.lastTime = time;
    this.bank.reset();
    this.smoothedRms = 0;
    this.smoothedCentroid = 0;
    this.smoothedFlux = 0;
    this.previousBandTotal = 0;
    for (const band of BANDS) {
      this.smoothedBands[band] = 0;
      this.smoothedOnsets[band] = 0;
    }
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

    // Single light smoothing stage for the global uniforms the shader reads.
    this.smoothedRms = smoothAudioValue(this.smoothedRms, frame.rms, safeDelta, 24, 8);
    this.smoothedCentroid = smoothAudioValue(
      this.smoothedCentroid,
      frame.centroid,
      safeDelta,
      18,
      6,
    );
    const bandTotal = frame.bands.low + frame.bands.mid + frame.bands.high;
    const flux = Math.max(0, bandTotal - this.previousBandTotal);
    this.previousBandTotal = bandTotal;
    this.smoothedFlux = smoothAudioValue(
      this.smoothedFlux,
      Math.min(1, flux * 1.6),
      safeDelta,
      30,
      8,
    );
    for (const band of BANDS) {
      this.smoothedBands[band] = smoothAudioValue(
        this.smoothedBands[band],
        frame.bands[band],
        safeDelta,
        26,
        9,
      );
      this.smoothedOnsets[band] = smoothAudioValue(
        this.smoothedOnsets[band],
        frame.onsets[band],
        safeDelta,
        40,
        12,
      );
    }

    const targets = projectFrameToTargets(frame, settings);
    this.bank.update(targets, settings, safeDelta);
    const modes = this.bank.selectSlots(frame, settings);

    this.lastTime = time;

    const dominant = modes[0];
    const excitation = modes.reduce(
      (sum, mode) => Math.max(sum, mode.excitation),
      frame.signals.excitation * 0.5,
    );

    return {
      modes,
      rms: this.smoothedRms,
      centroid: this.smoothedCentroid,
      flux: this.smoothedFlux,
      bands: { ...this.smoothedBands },
      onsets: { ...this.smoothedOnsets },
      peaks: frame.peaks,
      chroma: frame.chroma,
      signals: frame.signals,
      debug: {
        activeModeCount: this.bank.activeCount,
        backboneCount: modes.filter((mode) => mode.layer < 0.5).length,
        detailCount: modes.filter((mode) => mode.layer >= 0.5).length,
        peakSummary: formatPeakSummary(frame.peaks),
        topologyFrequency: dominant?.frequency ?? 0,
        topologyMode: dominant ? `${dominant.mode[0]}:${dominant.mode[1]}` : "none",
        excitation: clamp(excitation, 0, 1),
      },
    };
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
