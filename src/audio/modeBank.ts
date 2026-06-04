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

// Audio-motion envelope + how the two time-based motion layers respond to it.
// The envelope tracks "how much the music is moving right now" with a fast
// attack (so beats register) and a slow release (so it reads as the song's
// activity, not a flicker).
const AUDIO_MOTION_ATTACK_SECONDS = 0.05;
const AUDIO_MOTION_RELEASE_SECONDS = 0.45;
// Morph speed scales between MORPH_CALM_FLOOR (when silent) and 1 (full motion),
// so figures melt languidly during sustains and snappily on beats.
const MORPH_CALM_FLOOR = 0.3;
// Palette wander drifts at PALETTE_WANDER_BASE_RATE rad/s at full musical motion,
// never fully freezing (PALETTE_WANDER_IDLE floor). Bias amplitude kept gentle.
const PALETTE_WANDER_BASE_RATE = 0.08;
const PALETTE_WANDER_IDLE = 0.15;
const PALETTE_WANDER_BIAS = 0.16;

/**
 * Persistent bank of active Chladni modes. This is the ONLY place mode dynamics
 * are smoothed: each mode chases its projected target with a single asymmetric
 * exponential (fast attack, slower release). Replaces the old four-stage
 * driver → persistent-driver → modal-state → display-retention cascade.
 */
export class ModeBank {
  private readonly modes = new Map<string, BankMode>();
  // Per-rank smoothed displayed mode numbers (fractional) for figure morphing,
  // plus a running clock for the slow palette-wander LFO. See selectSlots.
  private readonly displayModes: Array<[number, number]> = Array.from(
    { length: MAX_MODAL_MODES },
    () => [1, 1],
  );
  // Continuously-accumulated phase for the slow palette-wander LFO. Kept as a
  // phase (not raw time) so the rate can be scaled without a discontinuity — the
  // "preview palette wander" button temporarily raises paletteWanderRateScale so
  // the otherwise track-length drift becomes visible in a few seconds.
  private wanderPhase = 0;
  paletteWanderRateScale = 1;
  // Smoothed "how much the music is moving right now" envelope (0..1): fast
  // attack on beats/onsets, slow release. Both the figure morph and the palette
  // wander run on this instead of a fixed wall clock, so they speed up with the
  // music and ease off during calm/sustained passages.
  private audioMotion = 0;
  private lastDelta = 1 / 60;

  reset() {
    this.modes.clear();
    this.wanderPhase = 0;
    this.audioMotion = 0;
    for (const display of this.displayModes) {
      display[0] = 1;
      display[1] = 1;
    }
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
    this.lastDelta = delta;
    // wanderPhase + the audio-motion envelope are advanced in selectSlots, which
    // has access to the frame's audio signals.
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

    // Advance the shared audio-motion envelope from this frame's rhythm/energy.
    // beat = on-beat impulse, pulse = continuous rhythm, change = spectral flux,
    // energy = loudness; together they read as "is the music moving right now".
    const s = frame.signals;
    const drive = clamp01(
      s.beat * 0.5 + s.pulse * 0.7 + s.change * 0.6 + s.energy * 0.35,
    );
    const motionTau =
      drive > this.audioMotion
        ? AUDIO_MOTION_ATTACK_SECONDS
        : AUDIO_MOTION_RELEASE_SECONDS;
    this.audioMotion +=
      (drive - this.audioMotion) * (1 - Math.exp(-this.lastDelta / motionTau));

    // Layer 4 — palette wandering: a slow per-mode LFO biases the *ranking* (not
    // the emitted brightness), so which figure dominates drifts over the song.
    // The drift advances with musical motion (and rests when calm) rather than on
    // a fixed clock.
    const wanderAmount = settings.cymaticPaletteWander
      ? settings.cymaticPaletteWanderAmount
      : 0;
    this.wanderPhase +=
      this.lastDelta *
      PALETTE_WANDER_BASE_RATE *
      this.paletteWanderRateScale *
      (PALETTE_WANDER_IDLE + (1 - PALETTE_WANDER_IDLE) * this.audioMotion);
    const rankWeight = (mode: BankMode) => {
      if (wanderAmount <= 0) {
        return mode.weight;
      }
      const bias =
        1 +
        PALETTE_WANDER_BIAS *
          wanderAmount *
          Math.sin(this.wanderPhase + hashMode(mode.entry.mode) * Math.PI * 2);
      return mode.weight * bias;
    };

    const ranked = Array.from(this.modes.values())
      .filter((mode) => mode.weight > 0.01)
      .sort((left, right) => rankWeight(right) - rankWeight(left))
      .slice(0, count);

    // Layer 2 — continuous mode morphing: ease each rank's displayed (fractional)
    // mode numbers toward its ranked entry so figures melt into one another. Snap
    // within an epsilon so a steady signal renders the exact canonical figure.
    // `cymaticMorphSeconds` is the morph time at full musical motion; it stretches
    // up to 1/MORPH_CALM_FLOOR longer when the music is calm, so morphs track the
    // song's energy instead of running at a fixed speed.
    const responsiveness =
      MORPH_CALM_FLOOR + (1 - MORPH_CALM_FLOOR) * this.audioMotion;
    const morphTau = Math.max(0.02, settings.cymaticMorphSeconds) / responsiveness;
    const morphAlpha = 1 - Math.exp(-this.lastDelta / morphTau);

    return ranked.map((mode, rank) => {
      const display = this.displayModes[rank];
      const target = mode.entry.mode;
      display[0] += (target[0] - display[0]) * morphAlpha;
      display[1] += (target[1] - display[1]) * morphAlpha;
      if (Math.abs(display[0] - target[0]) < 0.01) {
        display[0] = target[0];
      }
      if (Math.abs(display[1] - target[1]) < 0.01) {
        display[1] = target[1];
      }
      const emittedMode: [number, number] = settings.cymaticModeMorph
        ? [display[0], display[1]]
        : mode.entry.mode;
      const weight = clamp01(mode.weight);
      const coherence = clamp01(
        weight * 0.7 + frame.signals.harmonicity * 0.3,
      );
      const layer = rank === 0 ? 0 : rank < 3 ? 0.3 : 0.7;
      return {
        mode: emittedMode,
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
