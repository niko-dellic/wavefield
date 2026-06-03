import type { AudioFeatureFrame, CymaticSettings } from "../types.ts";
import { clamp01, createModeColor, hashMode } from "./modalMath.ts";
import type { ModeTarget } from "./modeProjection.ts";
import {
  MAX_MODAL_MODES,
  type ModalAtlasEntry,
  type ModalSlot,
} from "./modalTypes.ts";

type BankMode = {
  entry: ModalAtlasEntry;
  weight: number;
  targetWeight: number;
  excitation: number;
  targetExcitation: number;
  pulse: number;
  phase: number;
  idleSeconds: number;
};

const PRUNE_WEIGHT = 1e-4;
const PRUNE_IDLE_SECONDS = 0.6;

/**
 * Persistent bank of active Chladni modes. This is the ONLY place mode dynamics
 * are smoothed: each mode chases its projected target with a single asymmetric
 * exponential (fast attack, slower release). Replaces the old four-stage
 * driver → persistent-driver → modal-state → display-retention cascade.
 */
export class ModeBank {
  private readonly modes = new Map<string, BankMode>();

  reset() {
    this.modes.clear();
  }

  get activeCount() {
    let count = 0;
    for (const mode of this.modes.values()) {
      if (mode.weight > 0.02) {
        count += 1;
      }
    }
    return count;
  }

  update(targets: ModeTarget[], settings: CymaticSettings, deltaSeconds: number) {
    const delta = Math.max(1e-4, Math.min(0.1, deltaSeconds));
    const attackSeconds = Math.max(0.02, settings.morphSeconds);
    const releaseSeconds = Math.max(
      0.05,
      settings.morphSeconds * (1 + settings.modalDecay),
    );

    for (const mode of this.modes.values()) {
      mode.targetWeight = 0;
      mode.targetExcitation = 0;
      mode.idleSeconds += delta;
    }

    for (const target of targets) {
      const existing = this.modes.get(target.entry.key);
      if (existing) {
        existing.targetWeight = target.weight;
        existing.targetExcitation = target.excitation;
        existing.pulse = Math.max(existing.pulse, target.pulse);
        existing.idleSeconds = 0;
      } else {
        this.modes.set(target.entry.key, {
          entry: target.entry,
          weight: 0,
          targetWeight: target.weight,
          excitation: 0,
          targetExcitation: target.excitation,
          pulse: target.pulse,
          phase: hashMode(target.entry.mode) * Math.PI * 2,
          idleSeconds: 0,
        });
      }
    }

    const pulseDecay = Math.exp(-delta / Math.max(0.04, attackSeconds * 0.6));

    for (const [key, mode] of this.modes) {
      const weightTau =
        mode.targetWeight > mode.weight ? attackSeconds : releaseSeconds;
      const weightAlpha = 1 - Math.exp(-delta / weightTau);
      mode.weight += (mode.targetWeight - mode.weight) * weightAlpha;

      const excitationTau =
        mode.targetExcitation > mode.excitation
          ? 0.03
          : 0.12 * (1 + settings.modalDecay * 0.4);
      const excitationAlpha = 1 - Math.exp(-delta / excitationTau);
      mode.excitation +=
        (mode.targetExcitation - mode.excitation) * excitationAlpha;

      mode.pulse *= pulseDecay;

      mode.phase +=
        delta *
        (0.06 +
          mode.entry.frequencyNorm * 0.32 +
          mode.weight * 0.3 +
          mode.pulse * (0.5 + hashMode(mode.entry.mode) * 0.3));

      if (
        mode.weight < PRUNE_WEIGHT &&
        mode.targetWeight <= PRUNE_WEIGHT &&
        mode.idleSeconds > PRUNE_IDLE_SECONDS
      ) {
        this.modes.delete(key);
      }
    }
  }

  selectSlots(frame: AudioFeatureFrame, settings: CymaticSettings): ModalSlot[] {
    const count = Math.min(MAX_MODAL_MODES, Math.max(1, settings.modalCount));
    const ranked = Array.from(this.modes.values())
      .filter((mode) => mode.weight > 0.01)
      .sort((left, right) => right.weight - left.weight)
      .slice(0, count);

    return ranked.map((mode, rank) => {
      const weight = clamp01(mode.weight);
      const coherence = clamp01(
        weight * 0.7 + frame.signals.harmonicity * 0.3,
      );
      const layer = rank === 0 ? 0 : rank < 3 ? 0.3 : 0.7;
      return {
        mode: mode.entry.mode,
        sphericalMode: mode.entry.sphericalMode,
        frequency: mode.entry.naturalFrequency,
        amplitude: weight,
        topology: weight,
        phase: mode.phase,
        coherence,
        frequencyNorm: mode.entry.frequencyNorm,
        band: mode.entry.band,
        color: createModeColor(
          mode.entry.naturalFrequency,
          mode.entry.band,
          frame.chroma,
        ),
        colorWeight: clamp01(
          weight * 0.6 + mode.excitation * 0.3 + coherence * 0.1,
        ),
        driver: weight,
        excitation: clamp01(mode.excitation),
        pulse: clamp01(mode.pulse),
        layer,
      } satisfies ModalSlot;
    });
  }
}
